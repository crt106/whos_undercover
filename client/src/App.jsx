import { useState, useEffect, useCallback, useRef } from 'react';

// 观战申请审批卡片（内置10s自动拒绝倒计时）
function SpectateRequestCard({ req, onApprove, onReject }) {
  const [countdown, setCountdown] = useState(10);
  const timerRef = useRef(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          onReject(req);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  const handleReject = () => {
    clearInterval(timerRef.current);
    onReject(req);
  };

  const handleApprove = () => {
    clearInterval(timerRef.current);
    onApprove(req);
  };

  return (
    <div className="bg-white border border-violet-200 rounded-2xl shadow-lg p-4 animate-fade-in">
      <div className="flex items-center gap-3 mb-3">
        <span className="text-2xl shrink-0">{req.requesterAvatar || '👤'}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-700">
            <span className="font-bold text-gray-900">{req.requesterName}</span>
            {' '}申请观战你的游戏
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          className="flex-1 py-2 rounded-xl bg-violet-500 text-white text-sm font-bold active:scale-95 transition-all"
          onClick={handleApprove}
        >
          同意
        </button>
        <button
          className="flex-1 py-2 rounded-xl bg-gray-100 text-gray-600 text-sm font-bold active:scale-95 transition-all relative overflow-hidden"
          onClick={handleReject}
        >
          {/* 倒计时进度条背景 */}
          <span
            className="absolute inset-0 bg-gray-200 origin-left transition-none"
            style={{ transform: `scaleX(${countdown / 10})` }}
          />
          <span className="relative">拒绝 {countdown}s</span>
        </button>
      </div>
    </div>
  );
}
import socket from './socket';
import GatePassword from './pages/GatePassword';
import Home from './pages/Home';
import Room from './pages/Room';
import Game from './pages/Game';

function getPlayerId() {
  let id = localStorage.getItem('wuc_player_id');
  if (!id) {
    id = 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem('wuc_player_id', id);
  }
  return id;
}

function generateSessionId() {
  return 'sess_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [page, setPage] = useState('home');
  const [playerId] = useState(getPlayerId);
  const [playerName, setPlayerName] = useState(localStorage.getItem('wuc_player_name') || '');
  const [playerAvatar, setPlayerAvatar] = useState(localStorage.getItem('wuc_player_avatar') || '');
  const [roomId, setRoomId] = useState(null);
  const [roomState, setRoomState] = useState(null);
  const [myWord, setMyWord] = useState(null);
  const [myRole, setMyRole] = useState(null);
  const [voteResult, setVoteResult] = useState(null);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [disconnectNotice, setDisconnectNotice] = useState(null);
  const [isSpectator, setIsSpectator] = useState(false);
  // 观战申请状态：pendingRoomId 申请中的房间，rejectedRoomIds 被拒绝的房间集合
  const [spectateStatus, setSpectateStatus] = useState({ pendingRoomId: null, rejectedRoomIds: new Set() });
  // 房主待审批的观战请求列表
  const [spectateRequests, setSpectateRequests] = useState([]);
  const pageRef = useRef(page);
  pageRef.current = page;

  // 初始化认证检查
  useEffect(() => {
    const checkAuth = async () => {
      const params = new URLSearchParams(window.location.search);
      const urlPassword = params.get('pwd') || params.get('password');

      // 如果 URL 携带密码，直接验证
      if (urlPassword) {
        let sessionId = localStorage.getItem('gameSessionId');
        if (!sessionId) {
          sessionId = generateSessionId();
        }

        try {
          const response = await fetch('/api/verify-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: urlPassword, sessionId }),
          });

          if (response.ok) {
            localStorage.setItem('gameSessionId', sessionId);
            setAuthed(true);
          }
        } catch (err) {
          console.error('URL password verification failed:', err);
        }

        // 清除 URL 中的密码参数
        params.delete('pwd');
        params.delete('password');
        const clean = params.toString();
        const newUrl = window.location.pathname + (clean ? '?' + clean : '') + window.location.hash;
        window.history.replaceState({}, '', newUrl);
      } else if (localStorage.getItem('gameSessionId')) {
        // 没有 URL 密码，但有本地 sessionId
        setAuthed(true);
      }

      setAuthChecked(true);
    };

    checkAuth();
  }, []);

  // 自动清除错误
  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(''), 3000);
      return () => clearTimeout(t);
    }
  }, [error]);

  // Socket 连接 - 只在认证后连接
  useEffect(() => {
    if (!authed) return;

    socket.connect();

    socket.on('connect', () => {
      console.log('Socket connected:', socket.id);
      setConnected(true);

      // 每次连接/重连都重新 join room，确保 Socket.IO room 成员关系恢复
      const savedRoom = localStorage.getItem('wuc_room_id');
      const savedName = localStorage.getItem('wuc_player_name');
      const savedAvatar = localStorage.getItem('wuc_player_avatar');
      if (savedRoom && savedName) {
        socket.emit('join-room', {
          roomId: savedRoom,
          playerName: savedName,
          playerId,
          playerAvatar: savedAvatar || '',
        }, (res) => {
          if (res && !res.error) {
            setRoomId(savedRoom);
            setPlayerName(savedName);
            // 只有首次进入时才切页面，重连时保持当前页面
            if (pageRef.current === 'home') {
              if (res.word) {
                setMyWord(res.word);
                setPage('game');
              } else {
                setPage('room');
              }
            }
            // 重连时恢复词语
            if (res.word) {
              setMyWord(res.word);
            }
          } else {
            // 房间已不存在，清理
            if (pageRef.current === 'home') {
              localStorage.removeItem('wuc_room_id');
            }
          }
        });
      }
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected');
      setConnected(false);
    });

    socket.on('connect_error', (err) => {
      console.error('Socket connect error:', err.message);
      setConnected(false);
      // 如果是认证错误，清除本地 session 并要求重新登录
      if (err.message === '需要密码验证') {
        localStorage.removeItem('gameSessionId');
        setAuthed(false);
      }
    });

    socket.on('room-update', (state) => {
      setRoomState(state);
      // 所有玩家都在线时清除掉线通知
      if (state.players.every(p => p.online !== false)) {
        setDisconnectNotice(null);
      }
      if (state.phase === 'waiting') {
        if (pageRef.current === 'game') setPage('room');
      } else if (state.phase !== 'waiting' && pageRef.current === 'room') {
        setPage('game');
      }
    });

    socket.on('your-word', ({ word, role }) => {
      setMyWord(word);
      setMyRole(role);
    });

    socket.on('words-changed', () => {
      // 词语已换，your-word 事件会紧跟着送来新词
    });

    socket.on('vote-result', (result) => {
      setVoteResult(result);
    });

    socket.on('game-reset', () => {
      setMyWord(null);
      setMyRole(null);
      setVoteResult(null);
      setDisconnectNotice(null);
      setPage('room');
    });

    socket.on('player-disconnect-countdown', ({ playerName, seconds }) => {
      setDisconnectNotice({ playerName, seconds });
    });

    socket.on('game-aborted', ({ reason }) => {
      setDisconnectNotice(null);
      setError(reason);
    });

    socket.on('room-closed', ({ reason }) => {
      localStorage.removeItem('wuc_room_id');
      setRoomId(null);
      setRoomState(null);
      setMyWord(null);
      setMyRole(null);
      setVoteResult(null);
      setDisconnectNotice(null);
      setIsSpectator(false);
      setSpectateRequests([]);
      setPage('home');
      setError(reason || '房间已关闭');
    });

    // 收到观战申请（房主端）
    socket.on('spectate-request', ({ requesterId, requesterName, requesterAvatar, roomId: reqRoomId }) => {
      setSpectateRequests(prev => {
        if (prev.find(r => r.requesterId === requesterId)) return prev;
        return [...prev, { requesterId, requesterName, requesterAvatar, roomId: reqRoomId }];
      });
    });

    // 观战申请被批准（申请者端）
    socket.on('spectate-approved', ({ roomId: approvedRoomId }) => {
      setRoomId(approvedRoomId);
      setIsSpectator(true);
      setSpectateStatus({ pendingRoomId: null, rejectedRoomIds: new Set() });
      // 不存 localStorage，观战者不支持断线重连
      setPage('game');
    });

    // 观战申请被拒绝（申请者端）
    socket.on('spectate-rejected', ({ roomId: rejectedRoomId }) => {
      setSpectateStatus(prev => ({
        pendingRoomId: null,
        rejectedRoomIds: new Set([...prev.rejectedRoomIds, rejectedRoomId]),
      }));
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('connect_error');
      socket.off('room-update');
      socket.off('your-word');
      socket.off('vote-result');
      socket.off('game-reset');
      socket.off('words-changed');
      socket.off('player-disconnect-countdown');
      socket.off('game-aborted');
      socket.off('room-closed');
      socket.off('spectate-request');
      socket.off('spectate-approved');
      socket.off('spectate-rejected');
      socket.disconnect();
    };
  }, [authed, playerId]);

  const createRoom = useCallback((name, avatar) => {
    if (!socket.connected) {
      setError('正在连接服务器，请稍后再试...');
      return;
    }
    setPlayerName(name);
    setPlayerAvatar(avatar || '');
    localStorage.setItem('wuc_player_name', name);
    localStorage.setItem('wuc_player_avatar', avatar || '');
    socket.emit('create-room', { playerName: name, playerId, playerAvatar: avatar || '' }, (res) => {
      if (!res) {
        setError('服务器无响应，请检查网络');
        return;
      }
      if (res.error) {
        setError(res.error);
        return;
      }
      setRoomId(res.roomId);
      localStorage.setItem('wuc_room_id', res.roomId);
      setPage('room');
    });
  }, [playerId]);

  const joinRoom = useCallback((name, rid, avatar) => {
    if (!socket.connected) {
      setError('正在连接服务器，请稍后再试...');
      return;
    }
    setPlayerName(name);
    setPlayerAvatar(avatar || '');
    localStorage.setItem('wuc_player_name', name);
    localStorage.setItem('wuc_player_avatar', avatar || '');
    socket.emit('join-room', { roomId: rid, playerName: name, playerId, playerAvatar: avatar || '' }, (res) => {
      if (!res) {
        setError('服务器无响应，请检查网络');
        return;
      }
      if (res.error) {
        setError(res.error);
        return;
      }
      setRoomId(res.roomId);
      localStorage.setItem('wuc_room_id', res.roomId);
      if (res.word) {
        setMyWord(res.word);
        setPage('game');
      } else {
        setPage('room');
      }
    });
  }, [playerId]);

  const leaveRoom = useCallback(() => {
    localStorage.removeItem('wuc_room_id');
    setRoomId(null);
    setRoomState(null);
    setMyWord(null);
    setMyRole(null);
    setVoteResult(null);
    setIsSpectator(false);
    setSpectateRequests([]);
    setPage('home');
    socket.disconnect();
    socket.connect();
  }, []);

  const handleSpectateRequest = useCallback((rid) => {
    const savedName = localStorage.getItem('wuc_player_name') || playerName;
    const savedAvatar = localStorage.getItem('wuc_player_avatar') || playerAvatar;
    setSpectateStatus(prev => ({ ...prev, pendingRoomId: rid }));
    socket.emit('request-spectate', {
      roomId: rid,
      playerName: savedName,
      playerId,
      playerAvatar: savedAvatar,
    }, (res) => {
      if (res?.error) {
        setSpectateStatus(prev => ({ ...prev, pendingRoomId: null }));
        setError(res.error);
      }
    });
  }, [playerId, playerName, playerAvatar]);

  const handleApproveSpectate = useCallback((req) => {
    socket.emit('approve-spectate', { requesterId: req.requesterId, roomId: req.roomId });
    setSpectateRequests(prev => prev.filter(r => r.requesterId !== req.requesterId));
  }, []);

  const handleRejectSpectate = useCallback((req) => {
    socket.emit('reject-spectate', { requesterId: req.requesterId, roomId: req.roomId });
    setSpectateRequests(prev => prev.filter(r => r.requesterId !== req.requesterId));
  }, []);

  const handleGatePass = useCallback(() => {
    setAuthed(true);
  }, []);

  // 认证检查中，显示加载
  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-violet-500">加载中...</div>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <GatePassword onPass={handleGatePass} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {error && (
          <div
            className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-500 text-white px-6 py-3 rounded-2xl shadow-lg animate-fade-in max-w-sm text-center"
            onClick={() => setError('')}
          >
            {error}
          </div>
        )}

        {/* 房主观战审批通知（覆盖在任何页面上方） */}
        {spectateRequests.length > 0 && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40 w-full max-w-md px-4 space-y-2">
            {spectateRequests.map((req) => (
              <SpectateRequestCard
                key={req.requesterId}
                req={req}
                onApprove={handleApproveSpectate}
                onReject={handleRejectSpectate}
              />
            ))}
          </div>
        )}

        {page === 'home' && (
          <Home
            playerName={playerName}
            playerAvatar={playerAvatar}
            connected={connected}
            onCreateRoom={createRoom}
            onJoinRoom={joinRoom}
            onSpectate={handleSpectateRequest}
            spectateStatus={spectateStatus}
          />
        )}

        {page === 'room' && roomState && (
          <Room
            roomState={roomState}
            playerId={playerId}
            isSpectator={isSpectator}
            onLeave={leaveRoom}
          />
        )}

        {page === 'game' && roomState && (
          <Game
            roomState={roomState}
            playerId={playerId}
            myWord={myWord}
            myRole={myRole}
            voteResult={voteResult}
            setVoteResult={setVoteResult}
            disconnectNotice={disconnectNotice}
            isSpectator={isSpectator}
          />
        )}
      </div>
    </div>
  );
}
