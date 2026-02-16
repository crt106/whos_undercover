const { getRandomWordPair } = require('./words');

const PHASE = {
  WAITING: 'waiting',
  PLAYING: 'playing',
  SPEAKING: 'speaking',
  VOTING: 'voting',
  RESULT: 'result',
  GAME_OVER: 'game_over',
};

class Room {
  constructor(id, hostId) {
    this.id = id;
    this.hostId = hostId;
    this.players = []; // { id, name, ready, alive, role, word, vote, speech }
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
  }

  addPlayer(id, name) {
    if (this.phase !== PHASE.WAITING) return { error: '游戏已开始，无法加入' };
    if (this.players.length >= 12) return { error: '房间已满' };
    if (this.players.find(p => p.id === id)) return { error: '已在房间中' };

    const player = {
      id,
      name,
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
    return this.players.length >= 4 && this.players.every(p => p.ready);
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

    // 随机选择卧底
    const indices = this.players.map((_, i) => i);
    const shuffled = indices.sort(() => Math.random() - 0.5);
    const undercoverIndices = new Set(shuffled.slice(0, this.undercoverCount));

    this.players.forEach((p, i) => {
      p.alive = true;
      p.role = undercoverIndices.has(i) ? 'undercover' : 'civilian';
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
    // 回到准备阶段让玩家看新词
    this.phase = PHASE.PLAYING;
    this.round = 0;
    this.currentSpeakerIndex = -1;
  }

  startSpeaking() {
    this.round++;
    this.phase = PHASE.SPEAKING;
    this.players.forEach(p => {
      p.speech = null;
      p.vote = null;
    });

    // 找到第一个活着的玩家
    this.currentSpeakerIndex = this.players.findIndex(p => p.alive);
    return this.currentSpeakerIndex;
  }

  submitSpeech(playerId, speech) {
    const player = this.players.find(p => p.id === playerId);
    if (!player || !player.alive) return { error: '无效操作' };

    player.speech = speech;

    // 找下一个活着的玩家
    let nextIndex = -1;
    for (let i = this.currentSpeakerIndex + 1; i < this.players.length; i++) {
      if (this.players[i].alive && !this.players[i].speech) {
        nextIndex = i;
        break;
      }
    }

    if (nextIndex === -1) {
      // 所有人都发言完毕，进入投票
      this.phase = PHASE.VOTING;
      this.currentSpeakerIndex = -1;
      return { allDone: true };
    }

    this.currentSpeakerIndex = nextIndex;
    return { nextSpeaker: this.players[nextIndex].id, nextIndex };
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

    // 检查胜负
    const gameOver = this.checkWin();

    return {
      voteResult: this.voteResult,
      gameOver,
      votes: this.players
        .filter(p => p.vote)
        .map(p => ({ from: p.id, to: p.vote })),
    };
  }

  checkWin() {
    const aliveUndercover = this.players.filter(p => p.alive && p.role === 'undercover').length;
    const aliveCivilian = this.players.filter(p => p.alive && p.role === 'civilian').length;

    if (aliveUndercover === 0) {
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
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
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
