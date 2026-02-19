const { getRandomWordPair } = require('./words');

const PHASE = {
  WAITING: 'waiting',
  PLAYING: 'playing',
  SPEAKING: 'speaking',
  VOTING: 'voting',
  RESULT: 'result',
  UNDERCOVER_GUESS: 'undercover_guess', // 卧底最后猜词阶段
  GAME_OVER: 'game_over',
};

// Fisher-Yates 洗牌算法
function shuffleArray(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

class Room {
  constructor(id, hostId) {
    this.id = id;
    this.hostId = hostId;
    this.players = []; // { id, name, avatar, ready, alive, role, word, vote, speech }
    this.phase = PHASE.WAITING;
    this.undercoverCount = 1;
    this.round = 0;
    this.currentSpeakerIndex = -1;
    this.civilianWord = '';
    this.undercoverWord = '';
    this.speakingTimer = null;
    this.votingTimer = null;
    this.voteResult = null;
    this.winner = null;
    this.changeWordVotes = new Set(); // 投票换词的玩家ID集合
    this.wordChanged = false;         // 本局是否已换过词
    this.lastUndercoverIds = new Set(); // 上一局卧底的玩家ID
    this.speakingOrder = [];           // 当前局随机发言顺序（玩家ID数组）
    this.speakingOrderIndex = 0;       // 当前发言者在 speakingOrder 中的位置
    this.guessingUndercoverId = null;  // 正在猜词的卧底ID
    this.guessResult = null;           // 猜词结果 { playerId, guess, correct, timeout }
    this.speechHistory = [];           // 历史发言记录 [{ round, speeches: [{id, name, speech}] }]
  }

  addPlayer(id, name, avatar) {
    if (this.phase !== PHASE.WAITING) return { error: '游戏已开始，无法加入' };
    if (this.players.length >= 12) return { error: '房间已满' };
    if (this.players.find(p => p.id === id)) return { error: '已在房间中' };

    const player = {
      id,
      name,
      avatar: avatar || null,
      ready: false,
      alive: true,
      online: true,
      role: null,    // 'civilian' or 'undercover'
      word: null,
      vote: null,
      speech: null,  // { type: 'text'|'voice', content: string }
    };
    this.players.push(player);

    // 如果是第一个玩家（房主），自动准备
    if (this.players.length === 1) {
      player.ready = true;
    }

    return { success: true, player };
  }

  removePlayer(id) {
    const idx = this.players.findIndex(p => p.id === id);
    if (idx === -1) return;

    this.players.splice(idx, 1);

    // 如果房主离开，转移房主
    if (id === this.hostId && this.players.length > 0) {
      this.hostId = this.players[0].id;
    }

    return this.players.length === 0;
  }

  setOnline(playerId, online) {
    const player = this.players.find(p => p.id === playerId);
    if (player) player.online = online;
  }

  setReady(playerId, ready) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) return;
    player.ready = ready;
  }

  allReady() {
    // 房主不参与准备状态，只需非房主玩家全部准备即可
    return this.players.length >= 4 && this.players.every(p => p.id === this.hostId || p.ready);
  }

  setUndercoverCount(count) {
    const maxUndercover = Math.floor((this.players.length - 1) / 2);
    this.undercoverCount = Math.min(Math.max(1, count), maxUndercover || 1);
  }

  startGame() {
    if (this.players.length < 4) return { error: '至少需要4名玩家' };

    const maxUndercover = Math.floor((this.players.length - 1) / 2);
    if (this.undercoverCount > maxUndercover) {
      this.undercoverCount = maxUndercover;
    }

    const { civilianWord, undercoverWord } = getRandomWordPair();
    this.civilianWord = civilianWord;
    this.undercoverWord = undercoverWord;

    // 随机选择卧底（使用 Fisher-Yates，尽量不选上一局的卧底）
    let playerIds = this.players.map(p => p.id);
    const shuffled = shuffleArray(playerIds);

    // 若玩家数足够，将上一局卧底移到候选末尾，减少重复概率
    if (this.lastUndercoverIds.size > 0 && this.players.length > this.undercoverCount + this.lastUndercoverIds.size) {
      const nonLast = shuffled.filter(id => !this.lastUndercoverIds.has(id));
      const last = shuffled.filter(id => this.lastUndercoverIds.has(id));
      shuffled.length = 0;
      shuffled.push(...nonLast, ...last);
    }

    const undercoverIds = new Set(shuffled.slice(0, this.undercoverCount));
    this.lastUndercoverIds = new Set(undercoverIds);

    this.players.forEach(p => {
      p.alive = true;
      p.role = undercoverIds.has(p.id) ? 'undercover' : 'civilian';
      p.word = p.role === 'undercover' ? undercoverWord : civilianWord;
      p.vote = null;
      p.speech = null;
    });

    this.phase = PHASE.PLAYING;
    this.round = 0;
    this.winner = null;
    this.voteResult = null;
    this.changeWordVotes = new Set();
    this.wordChanged = false;
    this.speechHistory = [];

    return { success: true };
  }

  // 投票换词，返回 { voted, passed, total, needed }
  voteChangeWord(playerId) {
    if (this.wordChanged) return { error: '本局已换过词' };
    if (this.phase !== PHASE.PLAYING) {
      return { error: '仅准备阶段可以换词' };
    }
    const player = this.players.find(p => p.id === playerId);
    if (!player || !player.alive) return { error: '无效操作' };

    this.changeWordVotes.add(playerId);

    const total = this.players.length;
    const needed = Math.floor(total / 2) + 1;
    const current = this.changeWordVotes.size;

    if (current >= needed) {
      // 换词通过
      this.changeWords();
      return { passed: true, total, needed, current };
    }
    return { passed: false, total, needed, current };
  }

  changeWords() {
    const { civilianWord, undercoverWord } = getRandomWordPair();
    this.civilianWord = civilianWord;
    this.undercoverWord = undercoverWord;

    this.players.forEach(p => {
      p.word = p.role === 'undercover' ? undercoverWord : civilianWord;
      p.speech = null;
    });

    this.changeWordVotes = new Set();
    this.wordChanged = true;
    this.speechHistory = [];
    // 回到准备阶段让玩家看新词
    this.phase = PHASE.PLAYING;
    this.round = 0;
    this.currentSpeakerIndex = -1;
  }

  startSpeaking() {
    // 将上一轮发言存入历史（首轮前 round=0，无需存储）
    if (this.round > 0) {
      const speeches = this.players
        .filter(p => p.speech !== null)
        .map(p => ({ id: p.id, name: p.name, speech: p.speech }));
      if (speeches.length > 0) {
        this.speechHistory.push({ round: this.round, speeches });
      }
    }

    this.round++;
    this.phase = PHASE.SPEAKING;
    this.players.forEach(p => {
      p.speech = null;
      p.vote = null;
    });

    // 随机打乱活着玩家的发言顺序
    const aliveIds = this.players.filter(p => p.alive).map(p => p.id);
    this.speakingOrder = shuffleArray(aliveIds);
    this.speakingOrderIndex = 0;

    // 找到第一个发言者在 players 数组中的位置
    this.currentSpeakerIndex = this.players.findIndex(p => p.id === this.speakingOrder[0]);
    return this.currentSpeakerIndex;
  }

  submitSpeech(playerId, speech) {
    const player = this.players.find(p => p.id === playerId);
    if (!player || !player.alive) return { error: '无效操作' };

    player.speech = speech;

    // 按随机发言顺序找下一个未发言的玩家
    this.speakingOrderIndex++;

    if (this.speakingOrderIndex >= this.speakingOrder.length) {
      // 所有人都发言完毕，进入投票
      this.phase = PHASE.VOTING;
      this.currentSpeakerIndex = -1;
      return { allDone: true };
    }

    const nextPlayerId = this.speakingOrder[this.speakingOrderIndex];
    const nextIndex = this.players.findIndex(p => p.id === nextPlayerId);
    this.currentSpeakerIndex = nextIndex;
    return { nextSpeaker: nextPlayerId, nextIndex };
  }

  submitVote(playerId, targetId) {
    const player = this.players.find(p => p.id === playerId);
    if (!player || !player.alive) return { error: '无效操作' };
    if (playerId === targetId) return { error: '不能投自己' };

    const target = this.players.find(p => p.id === targetId);
    if (!target || !target.alive) return { error: '目标无效' };

    player.vote = targetId;

    // 检查是否所有活着的人都投了票
    const alivePlayers = this.players.filter(p => p.alive);
    const allVoted = alivePlayers.every(p => p.vote !== null);

    if (!allVoted) return { waiting: true };

    return this.resolveVotes();
  }

  resolveVotes() {
    // 统计票数
    const voteCount = {};
    this.players.forEach(p => {
      if (p.alive && p.vote) {
        voteCount[p.vote] = (voteCount[p.vote] || 0) + 1;
      }
    });

    // 找出最高票
    let maxVotes = 0;
    let candidates = [];
    for (const [id, count] of Object.entries(voteCount)) {
      if (count > maxVotes) {
        maxVotes = count;
        candidates = [id];
      } else if (count === maxVotes) {
        candidates.push(id);
      }
    }

    this.phase = PHASE.RESULT;
    let eliminatedPlayer = null;

    if (candidates.length === 1) {
      // 淘汰得票最高的人
      eliminatedPlayer = this.players.find(p => p.id === candidates[0]);
      eliminatedPlayer.alive = false;
    }
    // 平票则无人淘汰

    this.voteResult = {
      voteCount,
      eliminated: eliminatedPlayer ? {
        id: eliminatedPlayer.id,
        name: eliminatedPlayer.name,
        role: eliminatedPlayer.role,
      } : null,
      tie: candidates.length > 1,
    };

    // 检查胜负（传入本轮被淘汰的玩家，用于判断是否触发卧底猜词）
    const gameOver = this.checkWin(eliminatedPlayer);

    return {
      voteResult: this.voteResult,
      gameOver,
      votes: this.players
        .filter(p => p.vote)
        .map(p => ({ from: p.id, to: p.vote })),
    };
  }

  checkWin(eliminatedPlayer = null) {
    const aliveUndercover = this.players.filter(p => p.alive && p.role === 'undercover').length;
    const aliveCivilian = this.players.filter(p => p.alive && p.role === 'civilian').length;

    if (aliveUndercover === 0) {
      // 所有卧底都被淘汰——如果本轮淘汰的是最后一个卧底，给其猜词机会
      if (eliminatedPlayer && eliminatedPlayer.role === 'undercover') {
        this.phase = PHASE.UNDERCOVER_GUESS;
        this.guessingUndercoverId = eliminatedPlayer.id;
        return { guessRequired: true, guessingUndercoverId: eliminatedPlayer.id };
      }
      // 兜底：直接平民胜
      this.winner = 'civilian';
      this.phase = PHASE.GAME_OVER;
      return { winner: 'civilian', civilianWord: this.civilianWord, undercoverWord: this.undercoverWord };
    }

    if (aliveUndercover >= aliveCivilian) {
      this.winner = 'undercover';
      this.phase = PHASE.GAME_OVER;
      return { winner: 'undercover', civilianWord: this.civilianWord, undercoverWord: this.undercoverWord };
    }

    return null;
  }

  // 卧底提交猜词答案
  submitUndercoverGuess(playerId, guess) {
    if (this.phase !== PHASE.UNDERCOVER_GUESS) return { error: '不在猜词阶段' };
    if (playerId !== this.guessingUndercoverId) return { error: '只有被淘汰的卧底才能猜词' };

    const normalizedGuess = (guess || '').trim().toLowerCase();
    const normalizedAnswer = this.civilianWord.trim().toLowerCase();
    const correct = normalizedGuess === normalizedAnswer;

    this.guessResult = { playerId, guess: normalizedGuess, correct, timeout: false };
    this.winner = correct ? 'undercover' : 'civilian';
    this.phase = PHASE.GAME_OVER;

    return {
      correct,
      guess: normalizedGuess,
      winner: this.winner,
      civilianWord: this.civilianWord,
      undercoverWord: this.undercoverWord,
    };
  }

  // 猜词超时，平民获胜
  timeoutUndercoverGuess() {
    if (this.phase !== PHASE.UNDERCOVER_GUESS) return null;

    this.guessResult = { playerId: this.guessingUndercoverId, guess: null, correct: false, timeout: true };
    this.winner = 'civilian';
    this.phase = PHASE.GAME_OVER;

    return {
      correct: false,
      timeout: true,
      winner: 'civilian',
      civilianWord: this.civilianWord,
      undercoverWord: this.undercoverWord,
    };
  }

  getPublicState() {
    return {
      id: this.id,
      hostId: this.hostId,
      phase: this.phase,
      round: this.round,
      undercoverCount: this.undercoverCount,
      currentSpeakerIndex: this.currentSpeakerIndex,
      currentSpeakerId: this.currentSpeakerIndex >= 0 ? this.players[this.currentSpeakerIndex]?.id : null,
      voteResult: this.voteResult,
      winner: this.winner,
      changeWordVotes: this.changeWordVotes.size,
      changeWordNeeded: Math.floor(this.players.length / 2) + 1,
      changeWordVoters: [...this.changeWordVotes],
      wordChanged: this.wordChanged,
      // 卧底猜词相关
      guessingUndercoverId: this.guessingUndercoverId,
      guessResult: this.guessResult,
      // 历史发言记录
      speechHistory: this.speechHistory,
      // 游戏结束时暴露词语
      civilianWord: this.phase === PHASE.GAME_OVER ? this.civilianWord : null,
      undercoverWord: this.phase === PHASE.GAME_OVER ? this.undercoverWord : null,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        ready: p.ready,
        alive: p.alive,
        online: p.online,
        speech: p.speech,
        hasVoted: p.vote !== null,
        // 只在游戏结束时暴露角色
        role: this.phase === PHASE.GAME_OVER ? p.role : (p.alive ? null : p.role),
      })),
    };
  }

  getPlayerWord(playerId) {
    const player = this.players.find(p => p.id === playerId);
    return player ? player.word : null;
  }

  getPlayerRole(playerId) {
    const player = this.players.find(p => p.id === playerId);
    return player ? player.role : null;
  }

  // 游戏中某玩家掉线超时，中止游戏回到等待
  abortGame(disconnectedPlayerId) {
    this.removePlayer(disconnectedPlayerId);
    this.phase = PHASE.WAITING;
    this.round = 0;
    this.currentSpeakerIndex = -1;
    this.civilianWord = '';
    this.undercoverWord = '';
    this.voteResult = null;
    this.winner = null;
    this.changeWordVotes = new Set();
    this.wordChanged = false;
    this.speakingOrder = [];
    this.speakingOrderIndex = 0;
    this.lastUndercoverIds = new Set();
    this.guessingUndercoverId = null;
    this.guessResult = null;
    this.speechHistory = [];
    this.players.forEach(p => {
      p.ready = p.id === this.hostId;
      p.alive = true;
      p.role = null;
      p.word = null;
      p.vote = null;
      p.speech = null;
    });
  }

  resetForNewGame() {
    this.phase = PHASE.WAITING;
    this.round = 0;
    this.currentSpeakerIndex = -1;
    this.civilianWord = '';
    this.undercoverWord = '';
    this.voteResult = null;
    this.winner = null;
    this.changeWordVotes = new Set();
    this.wordChanged = false;
    this.speakingOrder = [];
    this.speakingOrderIndex = 0;
    this.guessingUndercoverId = null;
    this.guessResult = null;
    this.speechHistory = [];
    // lastUndercoverIds 保留，供下一局避免重复选择
    this.players.forEach(p => {
      p.ready = p.id === this.hostId;
      p.alive = true;
      p.role = null;
      p.word = null;
      p.vote = null;
      p.speech = null;
    });
  }
}

// 房间管理
const rooms = new Map();

function createRoom(hostId) {
  let roomId;
  do {
    roomId = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms.has(roomId));

  const room = new Room(roomId, hostId);
  rooms.set(roomId, room);
  return room;
}

function getRoom(roomId) {
  return rooms.get(roomId);
}

function deleteRoom(roomId) {
  rooms.delete(roomId);
}

module.exports = { Room, rooms, createRoom, getRoom, deleteRoom, PHASE };
