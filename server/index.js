require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { createRoom, getRoom, deleteRoom, PHASE } = require('./game');
const { sendWebhook } = require('./webhook');

const app = express();
const server = http.createServer(app);

const isProd = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3001;

// 密码校验中间件
const GAME_PASSWORD = process.env.GAME_PASSWORD || 'default123';

// 存储已验证的会话
const verifiedSessions = new Set();

// 密码校验中间件
// 先设置 JSON 解析中间件
app.use(express.json());

const requireAuth = (req, res, next) => {
  // 静态文件和首页不需要验证
  if (req.path === '/' || req.path.startsWith('/assets/') || req.path.endsWith('.html') || req.path.endsWith('.css') || req.path.endsWith('.js')) {
    return next();
  }

  // 密码验证接口本身不需要验证（中间件挂载到 /api 时，req.path 是相对路径）
  if (req.path === '/verify-password') {
    return next();
  }

  // 支持通过 URL 参数传递密码（兼容旧方式）
  if (req.query.password === GAME_PASSWORD) {
    return next();
  }

  const sessionId = req.headers['x-session-id'];
  if (!sessionId || !verifiedSessions.has(sessionId)) {
    return res.status(401).json({ error: '需要密码验证' });
  }

  next();
};

// 应用密码校验中间件到所有 API 路由
app.use('/api', requireAuth);
app.post('/api/verify-password', (req, res) => {
  const { password, sessionId } = req.body;

  if (!password || !sessionId) {
    return res.status(400).json({ error: '缺少密码或会话ID' });
  }

  if (password === GAME_PASSWORD) {
    verifiedSessions.add(sessionId);
    res.json({ success: true });
  } else {
    res.status(401).json({ error: '密码错误' });
  }
});

// Socket.IO
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  transports: ['polling', 'websocket'],
});

// 语音上传
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname) || '.webm'}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'];
    cb(null, allowed.includes(file.mimetype));
  },
});

app.post('/api/upload-voice', upload.single('voice'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '上传失败' });
  res.json({ url: `/api/voice/${req.file.filename}` });
});

app.get('/api/voice/:filename', (req, res) => {
  const filePath = path.join(uploadsDir, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.sendFile(filePath);
});

// 可被观战的游戏中阶段
const SPECTATABLE_PHASES = ['playing', 'speaking', 'voting', 'result', 'undercover_guess'];

// 房间列表 API
app.get('/api/rooms', (req, res) => {
  const { rooms } = require('./game');
  const roomList = [];

  for (const [roomId, room] of rooms.entries()) {
    const isWaiting = room.phase === 'waiting' && room.players.length > 0;
    const isSpectable = SPECTATABLE_PHASES.includes(room.phase);

    if (!isWaiting && !isSpectable) continue;

    const host = room.players.find(p => p.id === room.hostId);
    roomList.push({
      id: roomId,
      hostName: host ? host.name : '未知',
      playerCount: room.players.length,
      maxPlayers: 12,
      phase: room.phase,
      spectatorCount: room.spectators.length,
    });
  }

  // 按房间创建时间排序（房间号越小越早创建）
  roomList.sort((a, b) => a.id.localeCompare(b.id));

  res.json(roomList);
});

// 生产模式下服务静态文件
if (isProd) {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

// 玩家 socketId → { roomId, playerId }
const socketMap = new Map();
// 延迟移除计时器：playerId → timeout
const disconnectTimers = new Map();
// 游戏中掉线的最终等待计时器：timerKey → timeout
const gameDisconnectTimers = new Map();
// 游戏中掉线最终等待时间（秒）
const GAME_DISCONNECT_TIMEOUT = 60;
// 卧底猜词计时器：roomId → timeout
const guessTimers = new Map();
// 卧底猜词时间（秒）
const UNDERCOVER_GUESS_TIMEOUT = 30;
// 房间非活跃超时时间（毫秒）：1小时
const ROOM_INACTIVE_TIMEOUT = 60 * 60 * 1000;
// 房间超时检查间隔（毫秒）：5分钟
const ROOM_CHECK_INTERVAL = 5 * 60 * 1000;
// 待审批的观战请求：roomId → Map<playerId, { socketId, name, avatar }>
const pendingSpectatorRequests = new Map();

const gameIo = io.of('/game');

// WebSocket 连接验证中间件
gameIo.use((socket, next) => {
  const sessionId = socket.handshake.auth.sessionId;
  if (!sessionId || !verifiedSessions.has(sessionId)) {
    return next(new Error('需要密码验证'));
  }
  next();
});

gameIo.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  socket.on('create-room', ({ playerName, playerId, playerAvatar }, callback) => {
    const room = createRoom(playerId);
    const result = room.addPlayer(playerId, playerName, playerAvatar);
    if (result.error) {
      callback({ error: result.error });
      return;
    }

    socket.join(room.id);
    socketMap.set(socket.id, { roomId: room.id, playerId });
    callback({ roomId: room.id, playerId });
    gameIo.to(room.id).emit('room-update', room.getPublicState());
  });

  socket.on('join-room', ({ roomId, playerName, playerId, playerAvatar }, callback) => {
    const room = getRoom(roomId);
    if (!room) {
      callback({ error: '房间不存在' });
      return;
    }

    // 取消该玩家的延迟移除计时器（重连场景）
    const timerKey = `${roomId}:${playerId}`;
    if (disconnectTimers.has(timerKey)) {
      clearTimeout(disconnectTimers.get(timerKey));
      disconnectTimers.delete(timerKey);
      console.log('Cancelled disconnect timer for', playerName);
    }
    // 取消游戏中掉线计时器
    if (gameDisconnectTimers.has(timerKey)) {
      clearTimeout(gameDisconnectTimers.get(timerKey));
      gameDisconnectTimers.delete(timerKey);
      console.log('Cancelled game disconnect timer for', playerName);
    }

    // 检查是否是重连（玩家已在房间中）
    const existing = room.players.find(p => p.id === playerId);
    if (existing) {
      // 恢复在线状态
      room.setOnline(playerId, true);
      socket.join(room.id);
      socketMap.set(socket.id, { roomId: room.id, playerId });
      callback({
        roomId: room.id,
        playerId,
        word: room.phase !== PHASE.WAITING ? room.getPlayerWord(playerId) : null,
        role: room.phase === PHASE.GAME_OVER ? room.getPlayerRole(playerId) : null,
      });
      gameIo.to(room.id).emit('room-update', room.getPublicState());
      return;
    }

    const result = room.addPlayer(playerId, playerName, playerAvatar);
    if (result.error) {
      callback({ error: result.error });
      return;
    }

    socket.join(room.id);
    socketMap.set(socket.id, { roomId: room.id, playerId });
    callback({ roomId: room.id, playerId });
    gameIo.to(room.id).emit('room-update', room.getPublicState());
  });

  socket.on('player-ready', ({ ready }, callback) => {
    const info = socketMap.get(socket.id);
    if (!info) return;
    const room = getRoom(info.roomId);
    if (!room) return;

    room.setReady(info.playerId, ready);
    gameIo.to(room.id).emit('room-update', room.getPublicState());
    if (callback) callback({ success: true });
  });

  socket.on('set-undercover-count', ({ count }) => {
    const info = socketMap.get(socket.id);
    if (!info) return;
    const room = getRoom(info.roomId);
    if (!room || info.playerId !== room.hostId) return;

    room.setUndercoverCount(count);
    gameIo.to(room.id).emit('room-update', room.getPublicState());
  });

  socket.on('start-game', (_, callback) => {
    const info = socketMap.get(socket.id);
    if (!info) return;
    const room = getRoom(info.roomId);
    if (!room || info.playerId !== room.hostId) return;

    const result = room.startGame();
    if (result.error) {
      if (callback) callback({ error: result.error });
      return;
    }

    // 发给每个玩家他们各自的词
    room.players.forEach(p => {
      const sockets = findPlayerSockets(room.id, p.id);
      sockets.forEach(s => {
        s.emit('your-word', { word: p.word, role: p.role });
      });
    });

    gameIo.to(room.id).emit('room-update', room.getPublicState());

    // 发送游戏开始 webhook
    const host = room.players.find(p => p.id === room.hostId);
    sendWebhook('game_start', {
      roomId: room.id,
      hostName: host ? host.name : '未知',
      playerCount: room.players.length,
      undercoverCount: room.undercoverCount,
      startTime: new Date().toISOString(),
      players: room.players.map(p => ({ name: p.name, avatar: p.avatar })),
    });

    // 30秒准备时间后开始发言
    room._playingTimer = setTimeout(() => {
      if (room.phase === PHASE.PLAYING) {
        room.startSpeaking();
        gameIo.to(room.id).emit('room-update', room.getPublicState());
      }
    }, 30000);

    if (callback) callback({ success: true });
  });

  socket.on('vote-change-word', (_, callback) => {
    const info = socketMap.get(socket.id);
    if (!info) return;
    const room = getRoom(info.roomId);
    if (!room) return;

    const result = room.voteChangeWord(info.playerId);
    if (result.error) {
      if (callback) callback({ error: result.error });
      return;
    }

    if (result.passed) {
      // 换词通过，重新分发词语
      room.players.forEach(p => {
        const sockets = findPlayerSockets(room.id, p.id);
        sockets.forEach(s => {
          s.emit('your-word', { word: p.word, role: p.role });
        });
      });
      gameIo.to(room.id).emit('words-changed');

      // 清除旧计时器，重新给 30秒准备时间看新词
      if (room._playingTimer) clearTimeout(room._playingTimer);
      room._playingTimer = setTimeout(() => {
        if (room.phase === PHASE.PLAYING) {
          room.startSpeaking();
          gameIo.to(room.id).emit('room-update', room.getPublicState());
        }
      }, 30000);
    }

    gameIo.to(room.id).emit('room-update', room.getPublicState());
    if (callback) callback({ success: true, ...result });
  });

  socket.on('submit-speech', ({ speech }, callback) => {
    const info = socketMap.get(socket.id);
    if (!info) return;
    const room = getRoom(info.roomId);
    if (!room || room.phase !== PHASE.SPEAKING) return;

    const result = room.submitSpeech(info.playerId, speech);
    if (result.error) {
      if (callback) callback({ error: result.error });
      return;
    }

    gameIo.to(room.id).emit('room-update', room.getPublicState());

    if (result.allDone) {
      gameIo.to(room.id).emit('phase-change', { phase: PHASE.VOTING });
    }

    if (callback) callback({ success: true });
  });

  socket.on('submit-vote', ({ targetId }, callback) => {
    const info = socketMap.get(socket.id);
    if (!info) return;
    const room = getRoom(info.roomId);
    if (!room || room.phase !== PHASE.VOTING) return;

    const result = room.submitVote(info.playerId, targetId);
    if (result.error) {
      if (callback) callback({ error: result.error });
      return;
    }

    if (result.waiting) {
      gameIo.to(room.id).emit('room-update', room.getPublicState());
      if (callback) callback({ success: true });
      return;
    }

    // 投票结束
    gameIo.to(room.id).emit('vote-result', result);
    gameIo.to(room.id).emit('room-update', room.getPublicState());

    // 若触发卧底猜词阶段，启动超时计时器
    if (result.gameOver?.guessRequired) {
      const guessTimer = setTimeout(() => {
        guessTimers.delete(room.id);
        const currentRoom = getRoom(room.id);
        if (!currentRoom || currentRoom.phase !== PHASE.UNDERCOVER_GUESS) return;
        const timeoutResult = currentRoom.timeoutUndercoverGuess();
        if (timeoutResult) {
          gameIo.to(room.id).emit('undercover-guess-result', timeoutResult);
          gameIo.to(room.id).emit('room-update', currentRoom.getPublicState());
        }
      }, UNDERCOVER_GUESS_TIMEOUT * 1000);
      guessTimers.set(room.id, guessTimer);
    }

    if (callback) callback({ success: true, result });
  });

  socket.on('submit-undercover-guess', ({ guess }, callback) => {
    const info = socketMap.get(socket.id);
    if (!info) return;
    const room = getRoom(info.roomId);
    if (!room || room.phase !== PHASE.UNDERCOVER_GUESS) return;

    const result = room.submitUndercoverGuess(info.playerId, guess);
    if (result.error) {
      if (callback) callback({ error: result.error });
      return;
    }

    // 清除猜词计时器
    if (guessTimers.has(room.id)) {
      clearTimeout(guessTimers.get(room.id));
      guessTimers.delete(room.id);
    }

    gameIo.to(info.roomId).emit('undercover-guess-result', result);
    gameIo.to(info.roomId).emit('room-update', room.getPublicState());
    if (callback) callback({ success: true, result });
  });

  socket.on('next-round', () => {
    const info = socketMap.get(socket.id);
    if (!info) return;
    const room = getRoom(info.roomId);
    if (!room || info.playerId !== room.hostId) return;

    if (room.phase === PHASE.RESULT) {
      room.startSpeaking();
      gameIo.to(room.id).emit('room-update', room.getPublicState());
    }
  });

  socket.on('play-again', () => {
    const info = socketMap.get(socket.id);
    if (!info) return;
    const room = getRoom(info.roomId);
    if (!room || info.playerId !== room.hostId) return;

    // 清除可能残留的猜词计时器
    if (guessTimers.has(room.id)) {
      clearTimeout(guessTimers.get(room.id));
      guessTimers.delete(room.id);
    }

    room.resetForNewGame();
    gameIo.to(room.id).emit('room-update', room.getPublicState());
    gameIo.to(room.id).emit('game-reset');
  });

  // 房主强制关闭房间
  socket.on('force-close-room', (_, callback) => {
    const info = socketMap.get(socket.id);
    if (!info || info.isSpectator) { if (callback) callback({ error: '无权操作' }); return; }
    const room = getRoom(info.roomId);
    if (!room || info.playerId !== room.hostId) { if (callback) callback({ error: '无权操作' }); return; }

    const roomId = info.roomId;
    console.log(`Host force-closed room ${roomId}`);

    // 清理该房间所有计时器
    for (const [key] of disconnectTimers.entries()) {
      if (key.startsWith(`${roomId}:`)) {
        clearTimeout(disconnectTimers.get(key));
        disconnectTimers.delete(key);
      }
    }
    for (const [key] of gameDisconnectTimers.entries()) {
      if (key.startsWith(`${roomId}:`)) {
        clearTimeout(gameDisconnectTimers.get(key));
        gameDisconnectTimers.delete(key);
      }
    }
    if (guessTimers.has(roomId)) {
      clearTimeout(guessTimers.get(roomId));
      guessTimers.delete(roomId);
    }
    if (room._playingTimer) clearTimeout(room._playingTimer);
    pendingSpectatorRequests.delete(roomId);

    // 直接遍历 socketMap 逐个通知，绕开 socket.io room 成员可能不一致的问题
    const reason = '房主已关闭房间';
    for (const [sid, sInfo] of socketMap.entries()) {
      if (sInfo.roomId === roomId) {
        gameIo.sockets.get(sid)?.emit('room-closed', { reason });
      }
    }

    deleteRoom(roomId);
    if (callback) callback({ success: true });
  });

  // 申请观战
  socket.on('request-spectate', ({ roomId, playerName, playerId, playerAvatar }, callback) => {
    const room = getRoom(roomId);
    if (!room) { callback({ error: '房间不存在' }); return; }
    if (!SPECTATABLE_PHASES.includes(room.phase)) { callback({ error: '该房间当前不可观战' }); return; }
    if (room.players.find(p => p.id === playerId)) { callback({ error: '你已是游戏玩家' }); return; }
    if (room.spectators.find(s => s.id === playerId)) { callback({ error: '你已在观战中' }); return; }

    if (!pendingSpectatorRequests.has(roomId)) pendingSpectatorRequests.set(roomId, new Map());
    pendingSpectatorRequests.get(roomId).set(playerId, { socketId: socket.id, name: playerName, avatar: playerAvatar });

    const hostSockets = findPlayerSockets(roomId, room.hostId);
    if (hostSockets.length === 0) {
      pendingSpectatorRequests.get(roomId).delete(playerId);
      callback({ error: '房主不在线，无法申请观战' });
      return;
    }
    hostSockets.forEach(s => {
      s.emit('spectate-request', { requesterId: playerId, requesterName: playerName, requesterAvatar: playerAvatar, roomId });
    });
    callback({ pending: true });
  });

  // 房主同意观战
  socket.on('approve-spectate', ({ requesterId, roomId }) => {
    const info = socketMap.get(socket.id);
    if (!info) return;
    const room = getRoom(roomId || info.roomId);
    const effectiveRoomId = roomId || info.roomId;
    if (!room || info.playerId !== room.hostId) return;

    const pending = pendingSpectatorRequests.get(effectiveRoomId);
    if (!pending || !pending.has(requesterId)) return;
    const { socketId, name, avatar } = pending.get(requesterId);
    pending.delete(requesterId);

    room.addSpectator(requesterId, name, avatar);

    const requesterSocket = gameIo.sockets.get(socketId);
    if (requesterSocket) {
      requesterSocket.join(effectiveRoomId);
      socketMap.set(socketId, { roomId: effectiveRoomId, playerId: requesterId, isSpectator: true });
      requesterSocket.emit('spectate-approved', { roomId: effectiveRoomId });
    }
    gameIo.to(effectiveRoomId).emit('room-update', room.getPublicState());
  });

  // 房主拒绝观战
  socket.on('reject-spectate', ({ requesterId, roomId }) => {
    const info = socketMap.get(socket.id);
    if (!info) return;
    const effectiveRoomId = roomId || info.roomId;
    const room = getRoom(effectiveRoomId);
    if (!room || info.playerId !== room.hostId) return;

    const pending = pendingSpectatorRequests.get(effectiveRoomId);
    if (!pending || !pending.has(requesterId)) return;
    const { socketId } = pending.get(requesterId);
    pending.delete(requesterId);

    const requesterSocket = gameIo.sockets.get(socketId);
    if (requesterSocket) {
      requesterSocket.emit('spectate-rejected', { roomId: effectiveRoomId });
    }
  });

  socket.on('disconnect', () => {
    const info = socketMap.get(socket.id);
    if (!info) return;
    socketMap.delete(socket.id);

    // 清理此 socket 的待审批观战请求
    for (const [, requests] of pendingSpectatorRequests.entries()) {
      for (const [pid, req] of requests.entries()) {
        if (req.socketId === socket.id) requests.delete(pid);
      }
    }

    // 观战者断线处理
    if (info.isSpectator) {
      const room = getRoom(info.roomId);
      if (room) {
        room.removeSpectator(info.playerId);
        gameIo.to(info.roomId).emit('room-update', room.getPublicState());
      }
      return;
    }

    const { roomId, playerId } = info;
    const room = getRoom(roomId);
    if (!room) return;

    // 检查该玩家是否还有其他活跃的 socket 连接
    const remainingSockets = findPlayerSockets(roomId, playerId);
    if (remainingSockets.length > 0) {
      return;
    }

    // 立即标记为离线并广播
    room.setOnline(playerId, false);
    gameIo.to(roomId).emit('room-update', room.getPublicState());

    // 延迟移除：给 polling 重连和网络抖动留出时间
    const timerKey = `${roomId}:${playerId}`;
    const timer = setTimeout(() => {
      disconnectTimers.delete(timerKey);

      const sockets = findPlayerSockets(roomId, playerId);
      if (sockets.length > 0) return;

      const currentRoom = getRoom(roomId);
      if (!currentRoom) return;

      if (currentRoom.phase === PHASE.WAITING) {
        // 等待阶段直接移除
        const empty = currentRoom.removePlayer(playerId);
        if (empty) {
          deleteRoom(roomId);
        } else {
          gameIo.to(roomId).emit('room-update', currentRoom.getPublicState());
        }
      } else {
        // 游戏中：启动最终等待计时器
        startGameDisconnectTimer(roomId, playerId);
      }
    }, 8000);

    disconnectTimers.set(timerKey, timer);
    console.log('Player disconnected, waiting 8s before removing:', playerId);
  });
});

function startGameDisconnectTimer(roomId, playerId) {
  const timerKey = `${roomId}:${playerId}`;
  if (gameDisconnectTimers.has(timerKey)) return; // 已有计时器

  const room = getRoom(roomId);
  if (!room) return;
  const player = room.players.find(p => p.id === playerId);

  // 通知房间：玩家掉线，开始倒计时
  gameIo.to(roomId).emit('player-disconnect-countdown', {
    playerId,
    playerName: player?.name || '未知',
    seconds: GAME_DISCONNECT_TIMEOUT,
  });

  const timer = setTimeout(() => {
    gameDisconnectTimers.delete(timerKey);

    // 再次检查是否已重连
    const sockets = findPlayerSockets(roomId, playerId);
    if (sockets.length > 0) return;

    const currentRoom = getRoom(roomId);
    if (!currentRoom) return;
    if (currentRoom.phase === PHASE.WAITING || currentRoom.phase === PHASE.GAME_OVER) return;

    const disconnectedPlayer = currentRoom.players.find(p => p.id === playerId);
    console.log('Game disconnect timeout, aborting game. Player:', disconnectedPlayer?.name);

    // 清除可能残留的猜词计时器
    if (guessTimers.has(roomId)) {
      clearTimeout(guessTimers.get(roomId));
      guessTimers.delete(roomId);
    }

    // 中止游戏，移除掉线玩家，回到等待
    currentRoom.abortGame(playerId);
    gameIo.to(roomId).emit('game-aborted', {
      reason: `玩家 ${disconnectedPlayer?.name || '未知'} 掉线超时，游戏已中止`,
    });
    gameIo.to(roomId).emit('game-reset');
    gameIo.to(roomId).emit('room-update', currentRoom.getPublicState());
  }, GAME_DISCONNECT_TIMEOUT * 1000);

  gameDisconnectTimers.set(timerKey, timer);
}

// 定期检查并关闭超时的非活跃房间
setInterval(() => {
  const { rooms } = require('./game');
  const now = Date.now();

  for (const [roomId, room] of rooms.entries()) {
    const isInactive = room.phase === PHASE.WAITING || room.phase === PHASE.GAME_OVER;
    if (!isInactive || !room.inactiveStartTime) continue;

    if (now - room.inactiveStartTime >= ROOM_INACTIVE_TIMEOUT) {
      console.log(`Room ${roomId} inactive for over 1 hour, closing.`);

      // 清理该房间相关的所有计时器
      for (const [key] of disconnectTimers.entries()) {
        if (key.startsWith(`${roomId}:`)) {
          clearTimeout(disconnectTimers.get(key));
          disconnectTimers.delete(key);
        }
      }
      for (const [key] of gameDisconnectTimers.entries()) {
        if (key.startsWith(`${roomId}:`)) {
          clearTimeout(gameDisconnectTimers.get(key));
          gameDisconnectTimers.delete(key);
        }
      }
      if (guessTimers.has(roomId)) {
        clearTimeout(guessTimers.get(roomId));
        guessTimers.delete(roomId);
      }

      // 直接遍历 socketMap 逐个通知（绕开 socket.io room 成员不一致的问题）
      for (const [sid, sInfo] of socketMap.entries()) {
        if (sInfo.roomId === roomId) {
          gameIo.sockets.get(sid)?.emit('room-closed', { reason: '房间长时间无活动，已自动关闭' });
        }
      }
      deleteRoom(roomId);
    }
  }
}, ROOM_CHECK_INTERVAL);

function findPlayerSockets(roomId, playerId) {
  const sockets = [];
  for (const [socketId, info] of socketMap.entries()) {
    if (info.roomId === roomId && info.playerId === playerId) {
      const s = gameIo.sockets.get(socketId);
      if (s) sockets.push(s);
    }
  }
  return sockets;
}

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
