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

const UNDERCOVER_GUESS_MODE = {
  EVERY: 'every_undercover',
  FINAL: 'final_undercover',
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
    this.undercoverGuessMode = UNDERCOVER_GUESS_MODE.EVERY;
    this.blankEnabled = false; // 是否启用白板（无词卧底）
    this.round = 0;
    this.currentSpeakerIndex = -1;
    this.civilianWord = '';
    this.undercoverWord = '';
    this.speakingTimer = null;
    this.votingTimer = null;
    this.voteResult = null;
    this.winner = null;
    this.changeWordVotes = new Set(); // 当前一轮投票换词的玩家ID集合
    this.wordChanged = false;         // 本局是否发生过换词
    this.wordChangeCount = 0;         // 本局换词次数，用于客户端重置准备倒计时
    this.lastNonCivilianIds = new Set(); // 上一局非平民（卧底+白板）玩家ID
    this.speakingOrder = [];           // 当前局随机发言顺序（玩家ID数组）
    this.speakingOrderIndex = 0;       // 当前发言者在 speakingOrder 中的位置
    this.battleRound = 0;              // 当前大轮内第几次平票 battle
    this.battleCandidates = [];        // 当前平票 battle 候选玩家ID
    this.voteScope = 'all';            // 'all' 或 'battle'
    this.currentSpeechKey = null;      // 当前发言 Tab 的稳定 key
    this.currentSpeechLabel = null;    // 当前发言 Tab 展示名
    this.guessingUndercoverId = null;  // 正在猜词的卧底ID
    this.guessResult = null;           // 猜词结果 { playerId, guess, correct, timeout }
    this.speechHistory = [];           // 历史发言记录 [{ round, speeches: [{id, name, speech}] }]
    this.inactiveStartTime = Date.now(); // 进入非活跃状态（waiting/game_over）的时间戳
    this.spectators = [];              // 观战者列表 [{ id, name, avatar, online }]
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

    this.normalizeUndercoverCount();

    return this.players.length === 0;
  }

  setOnline(playerId, online) {
    const player = this.players.find(p => p.id === playerId);
    if (player) player.online = online;
  }

  addSpectator(id, name, avatar) {
    if (this.spectators.find(s => s.id === id)) return;
    this.spectators.push({ id, name, avatar: avatar || null, online: true });
  }

  removeSpectator(id) {
    const idx = this.spectators.findIndex(s => s.id === id);
    if (idx !== -1) this.spectators.splice(idx, 1);
  }

  setSpectatorOnline(id, online) {
    const s = this.spectators.find(s => s.id === id);
    if (s) s.online = online;
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

  // 启用白板时为白板预留 1 个非平民名额
  getNonCivilianReserve() {
    return this.blankEnabled ? 1 : 0;
  }

  getMaxUndercoverCount() {
    const reserved = this.getNonCivilianReserve();
    return Math.max(1, Math.floor((this.players.length - 1) / 2) - reserved);
  }

  normalizeUndercoverCount() {
    this.undercoverCount = Math.min(this.undercoverCount, this.getMaxUndercoverCount());
  }

  setUndercoverCount(count) {
    this.undercoverCount = Math.min(Math.max(1, count), this.getMaxUndercoverCount());
  }

  setUndercoverGuessMode(mode) {
    if (!Object.values(UNDERCOVER_GUESS_MODE).includes(mode)) {
      return { error: '无效的猜词模式' };
    }
    if (this.phase !== PHASE.WAITING) {
      return { error: '仅等待阶段可以修改猜词模式' };
    }
    this.undercoverGuessMode = mode;
    return { success: true };
  }

  setBlankEnabled(enabled) {
    if (this.phase !== PHASE.WAITING) {
      return { error: '仅等待阶段可以修改白板模式' };
    }
    this.blankEnabled = !!enabled;
    this.normalizeUndercoverCount();
    return { success: true };
  }

  startGame() {
    if (this.players.length < 4) return { error: '至少需要4名玩家' };

    this.normalizeUndercoverCount();

    const reserve = this.getNonCivilianReserve();
    // 启用白板时需保证非平民人数严格少于平民
    if (this.undercoverCount + reserve > Math.floor((this.players.length - 1) / 2)) {
      return { error: '当前人数不足以同时容纳卧底与白板' };
    }
    if (this.blankEnabled && this.players.length < 5) {
      return { error: '白板模式至少需要5名玩家' };
    }

    const { civilianWord, undercoverWord } = getRandomWordPair();
    this.civilianWord = civilianWord;
    this.undercoverWord = undercoverWord;

    // 随机选择非平民（卧底 + 白板），尽量不选上一局的非平民
    let playerIds = this.players.map(p => p.id);
    const shuffled = shuffleArray(playerIds);

    const totalNonCivilian = this.undercoverCount + reserve;
    if (this.lastNonCivilianIds.size > 0 && this.players.length > totalNonCivilian + this.lastNonCivilianIds.size) {
      const nonLast = shuffled.filter(id => !this.lastNonCivilianIds.has(id));
      const last = shuffled.filter(id => this.lastNonCivilianIds.has(id));
      shuffled.length = 0;
      shuffled.push(...nonLast, ...last);
    }

    const undercoverIds = new Set(shuffled.slice(0, this.undercoverCount));
    const blankId = this.blankEnabled
      ? shuffled.slice(this.undercoverCount, this.undercoverCount + 1)[0]
      : null;

    this.lastNonCivilianIds = new Set([
      ...undercoverIds,
      ...(blankId ? [blankId] : []),
    ]);

    this.players.forEach(p => {
      p.alive = true;
      if (undercoverIds.has(p.id)) {
        p.role = 'undercover';
        p.word = undercoverWord;
      } else if (p.id === blankId) {
        p.role = 'blank';
        p.word = null;
      } else {
        p.role = 'civilian';
        p.word = civilianWord;
      }
      p.vote = null;
      p.speech = null;
    });

    this.phase = PHASE.PLAYING;
    this.round = 0;
    this.winner = null;
    this.voteResult = null;
    this.guessResult = null;
    this.guessingUndercoverId = null;
    this.changeWordVotes = new Set();
    this.wordChanged = false;
    this.wordChangeCount = 0;
    this.battleRound = 0;
    this.battleCandidates = [];
    this.voteScope = 'all';
    this.currentSpeechKey = null;
    this.currentSpeechLabel = null;
    this.speechHistory = [];
    this.inactiveStartTime = null; // 游戏进行中，不计入非活跃时间

    return { success: true };
  }

  // 投票换词，返回 { voted, passed, total, needed }
  voteChangeWord(playerId) {
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
      if (p.role === 'undercover') p.word = undercoverWord;
      else if (p.role === 'blank') p.word = null;
      else p.word = civilianWord;
      p.speech = null;
    });

    this.changeWordVotes = new Set();
    this.wordChanged = true;
    this.wordChangeCount++;
    this.speechHistory = [];
    // 回到准备阶段让玩家看新词
    this.phase = PHASE.PLAYING;
    this.round = 0;
    this.currentSpeakerIndex = -1;
    this.battleRound = 0;
    this.battleCandidates = [];
    this.voteScope = 'all';
    this.currentSpeechKey = null;
    this.currentSpeechLabel = null;
  }

  startSpeaking() {
    this.archiveCurrentSpeeches();

    this.round++;
    this.phase = PHASE.SPEAKING;
    this.battleRound = 0;
    this.battleCandidates = [];
    this.voteScope = 'all';
    this.currentSpeechKey = `round-${this.round}`;
    this.currentSpeechLabel = `第${this.round}轮`;
    this.guessResult = null;
    this.guessingUndercoverId = null;
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

  startBattleSpeaking(candidateIds) {
    this.archiveCurrentSpeeches();

    this.battleRound++;
    this.battleCandidates = candidateIds.filter(id => {
      const player = this.players.find(p => p.id === id);
      return player?.alive;
    });
    this.voteScope = 'battle';
    this.phase = PHASE.SPEAKING;
    this.currentSpeechKey = `round-${this.round}-battle-${this.battleRound}`;
    this.currentSpeechLabel = `平票battle-${this.battleRound}`;
    this.guessResult = null;
    this.guessingUndercoverId = null;
    this.players.forEach(p => {
      p.speech = null;
      p.vote = null;
    });

    this.speakingOrder = shuffleArray(this.battleCandidates);
    this.speakingOrderIndex = 0;
    this.currentSpeakerIndex = this.players.findIndex(p => p.id === this.speakingOrder[0]);
    return this.currentSpeakerIndex;
  }

  archiveCurrentSpeeches() {
    if (!this.currentSpeechKey) return;

    const speeches = this.players
      .filter(p => p.speech !== null)
      .map(p => ({ id: p.id, name: p.name, speech: p.speech }));

    if (speeches.length === 0) return;
    if (this.speechHistory.some(entry => entry.key === this.currentSpeechKey)) return;

    this.speechHistory.push({
      key: this.currentSpeechKey,
      label: this.currentSpeechLabel || `第${this.round}轮`,
      round: this.round,
      battleRound: this.voteScope === 'battle' ? this.battleRound : 0,
      type: this.voteScope === 'battle' ? 'battle' : 'round',
      speeches,
    });
  }

  submitSpeech(playerId, speech) {
    const player = this.players.find(p => p.id === playerId);
    if (!player || !player.alive) return { error: '无效操作' };
    if (this.speakingOrder[this.speakingOrderIndex] !== playerId) return { error: '还没轮到你发言' };

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
    if (this.voteScope === 'battle' && !this.battleCandidates.includes(targetId)) {
      return { error: '只能投给平票候选人' };
    }

    player.vote = targetId;

    // 检查是否所有活着的人都投了票
    const alivePlayers = this.players.filter(p => p.alive);
    const allVoted = alivePlayers.every(p => p.vote !== null);

    if (!allVoted) return { waiting: true };

    return this.resolveVotes();
  }

  resolveVotes() {
    const submittedVotes = this.players
      .filter(p => p.vote)
      .map(p => ({ from: p.id, to: p.vote }));

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

    let eliminatedPlayer = null;

    if (candidates.length > 1) {
      this.voteResult = {
        voteCount,
        eliminated: null,
        tie: true,
        tieBattle: true,
        battleRound: this.battleRound + 1,
        tiedPlayers: candidates.map(id => {
          const player = this.players.find(p => p.id === id);
          return { id, name: player?.name || '未知' };
        }),
      };
      this.startBattleSpeaking(candidates);
      return {
        voteResult: this.voteResult,
        gameOver: null,
        votes: submittedVotes,
        tieBattle: true,
      };
    }

    this.phase = PHASE.RESULT;
    eliminatedPlayer = this.players.find(p => p.id === candidates[0]);
    eliminatedPlayer.alive = false;
    this.battleCandidates = [];
    this.voteScope = 'all';

    this.voteResult = {
      voteCount,
      eliminated: eliminatedPlayer ? {
        id: eliminatedPlayer.id,
        name: eliminatedPlayer.name,
        role: eliminatedPlayer.role,
      } : null,
      tie: false,
    };

    // 检查胜负（传入本轮被淘汰的玩家，用于判断是否触发卧底猜词）
    const gameOver = this.checkWin(eliminatedPlayer);

    return {
      voteResult: this.voteResult,
      gameOver,
      votes: submittedVotes,
    };
  }

  // 卧底胜利的存活人数阈值：< 7 时 2 人，>= 7 时 3 人
  getUndercoverWinThreshold() {
    return this.players.length >= 7 ? 3 : 2;
  }

  checkWin(eliminatedPlayer = null) {
    const aliveUndercover = this.players.filter(p => p.alive && p.role === 'undercover').length;
    const aliveBlank = this.players.filter(p => p.alive && p.role === 'blank').length;
    const aliveCivilian = this.players.filter(p => p.alive && p.role === 'civilian').length;
    const aliveNonCivilian = aliveUndercover + aliveBlank;
    const aliveTotal = aliveNonCivilian + aliveCivilian;

    const eliminatedNonCivilian = eliminatedPlayer?.role === 'undercover' || eliminatedPlayer?.role === 'blank';
    const needsGuess = eliminatedNonCivilian
      && (
        this.undercoverGuessMode === UNDERCOVER_GUESS_MODE.EVERY
        || (this.undercoverGuessMode === UNDERCOVER_GUESS_MODE.FINAL && aliveNonCivilian === 0)
      );

    if (needsGuess) {
      this.phase = PHASE.UNDERCOVER_GUESS;
      this.guessingUndercoverId = eliminatedPlayer.id;
      return {
        guessRequired: true,
        guessingUndercoverId: eliminatedPlayer.id,
        guessMode: this.undercoverGuessMode,
      };
    }

    return this.evaluateWinCondition();
  }

  // 不依赖被淘汰者的胜负判定，供猜词阶段后复用
  evaluateWinCondition() {
    const aliveUndercover = this.players.filter(p => p.alive && p.role === 'undercover').length;
    const aliveBlank = this.players.filter(p => p.alive && p.role === 'blank').length;
    const aliveCivilian = this.players.filter(p => p.alive && p.role === 'civilian').length;
    const aliveNonCivilian = aliveUndercover + aliveBlank;
    const aliveTotal = aliveNonCivilian + aliveCivilian;

    // 平民胜：所有卧底+白板都出局
    if (aliveNonCivilian === 0) {
      this.winner = 'civilian';
      this.phase = PHASE.GAME_OVER;
      this.inactiveStartTime = Date.now();
      return { winner: 'civilian', civilianWord: this.civilianWord, undercoverWord: this.undercoverWord };
    }

    // 白板独立胜：所有卧底出局且白板存活
    if (aliveUndercover === 0 && aliveBlank > 0) {
      this.winner = 'blank';
      this.phase = PHASE.GAME_OVER;
      this.inactiveStartTime = Date.now();
      return { winner: 'blank', civilianWord: this.civilianWord, undercoverWord: this.undercoverWord };
    }

    // 卧底胜：存活人数到达阈值且卧底未死
    if (aliveUndercover > 0 && aliveTotal <= this.getUndercoverWinThreshold()) {
      this.winner = 'undercover';
      this.phase = PHASE.GAME_OVER;
      this.inactiveStartTime = Date.now();
      return { winner: 'undercover', civilianWord: this.civilianWord, undercoverWord: this.undercoverWord };
    }

    return null;
  }

  // 卧底/白板提交猜词答案
  submitUndercoverGuess(playerId, guess) {
    if (this.phase !== PHASE.UNDERCOVER_GUESS) return { error: '不在猜词阶段' };
    if (playerId !== this.guessingUndercoverId) return { error: '只有被淘汰的卧底/白板才能猜词' };

    const guessingPlayer = this.players.find(p => p.id === playerId);
    const normalizedGuess = (guess || '').trim().toLowerCase();
    const normalizedAnswer = this.civilianWord.trim().toLowerCase();
    const correct = normalizedGuess === normalizedAnswer;

    this.guessResult = { playerId, guess: normalizedGuess, correct, timeout: false };

    if (correct) {
      // 白板猜对独胜，卧底猜对卧底胜
      this.winner = guessingPlayer?.role === 'blank' ? 'blank' : 'undercover';
      this.phase = PHASE.GAME_OVER;
      this.inactiveStartTime = Date.now();
    } else {
      this.finishFailedUndercoverGuess();
    }

    return {
      correct,
      guess: normalizedGuess,
      winner: this.winner,
      phase: this.phase,
      civilianWord: this.phase === PHASE.GAME_OVER ? this.civilianWord : null,
      undercoverWord: this.phase === PHASE.GAME_OVER ? this.undercoverWord : null,
    };
  }

  // 猜词超时，平民获胜
  timeoutUndercoverGuess() {
    if (this.phase !== PHASE.UNDERCOVER_GUESS) return null;

    this.guessResult = { playerId: this.guessingUndercoverId, guess: null, correct: false, timeout: true };
    this.finishFailedUndercoverGuess();

    return {
      correct: false,
      timeout: true,
      winner: this.winner,
      phase: this.phase,
      civilianWord: this.phase === PHASE.GAME_OVER ? this.civilianWord : null,
      undercoverWord: this.phase === PHASE.GAME_OVER ? this.undercoverWord : null,
    };
  }

  finishFailedUndercoverGuess() {
    // 与正常淘汰后判定一致：可能触发平民胜 / 白板独胜 / 卧底胜
    const result = this.evaluateWinCondition();
    if (!result) {
      this.winner = null;
      this.phase = PHASE.RESULT;
      this.guessingUndercoverId = null;
    }
  }

  getPublicState() {
    const aliveCivilianCount = this.players.filter(p => p.alive && p.role === 'civilian').length;
    const aliveNonCivilianCount = this.players.filter(
      p => p.alive && (p.role === 'undercover' || p.role === 'blank')
    ).length;

    return {
      id: this.id,
      hostId: this.hostId,
      phase: this.phase,
      round: this.round,
      undercoverCount: this.undercoverCount,
      undercoverGuessMode: this.undercoverGuessMode,
      blankEnabled: this.blankEnabled,
      aliveCivilianCount,
      aliveNonCivilianCount,
      battleRound: this.battleRound,
      battleCandidates: [...this.battleCandidates],
      voteScope: this.voteScope,
      currentSpeechKey: this.currentSpeechKey,
      currentSpeechLabel: this.currentSpeechLabel,
      currentSpeakerIndex: this.currentSpeakerIndex,
      currentSpeakerId: this.currentSpeakerIndex >= 0 ? this.players[this.currentSpeakerIndex]?.id : null,
      voteResult: this.voteResult,
      winner: this.winner,
      changeWordVotes: this.changeWordVotes.size,
      changeWordNeeded: Math.floor(this.players.length / 2) + 1,
      changeWordVoters: [...this.changeWordVotes],
      wordChanged: this.wordChanged,
      wordChangeCount: this.wordChangeCount,
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
      spectators: this.spectators.map(s => ({
        id: s.id,
        name: s.name,
        avatar: s.avatar,
        online: s.online,
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
    this.inactiveStartTime = Date.now();
    this.round = 0;
    this.currentSpeakerIndex = -1;
    this.civilianWord = '';
    this.undercoverWord = '';
    this.voteResult = null;
    this.winner = null;
    this.changeWordVotes = new Set();
    this.wordChanged = false;
    this.wordChangeCount = 0;
    this.speakingOrder = [];
    this.speakingOrderIndex = 0;
    this.battleRound = 0;
    this.battleCandidates = [];
    this.voteScope = 'all';
    this.currentSpeechKey = null;
    this.currentSpeechLabel = null;
    this.lastNonCivilianIds = new Set();
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
    this.inactiveStartTime = Date.now();
    this.round = 0;
    this.currentSpeakerIndex = -1;
    this.civilianWord = '';
    this.undercoverWord = '';
    this.voteResult = null;
    this.winner = null;
    this.changeWordVotes = new Set();
    this.wordChanged = false;
    this.wordChangeCount = 0;
    this.speakingOrder = [];
    this.speakingOrderIndex = 0;
    this.battleRound = 0;
    this.battleCandidates = [];
    this.voteScope = 'all';
    this.currentSpeechKey = null;
    this.currentSpeechLabel = null;
    this.guessingUndercoverId = null;
    this.guessResult = null;
    this.speechHistory = [];
    // lastNonCivilianIds 保留，供下一局避免重复选择
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
