const test = require('node:test');
const assert = require('node:assert/strict');

const { Room, PHASE } = require('../server/game');

function createStartedRoom({ playerCount, undercoverCount, guessMode = 'every_undercover', blankEnabled = false }) {
  const room = new Room(`test-${playerCount}-${undercoverCount}`, 'p1');

  for (let i = 1; i <= playerCount; i++) {
    const id = `p${i}`;
    const result = room.addPlayer(id, `Player ${i}`);
    assert.equal(result.success, true);
    room.setReady(id, true);
  }

  if (blankEnabled) {
    room.setBlankEnabled(true);
  }
  room.setUndercoverCount(undercoverCount);
  room.setUndercoverGuessMode(guessMode);

  const result = room.startGame();
  assert.equal(result.success, true);
  assert.equal(room.phase, PHASE.PLAYING);

  return room;
}

function forceRoles(room, undercoverIds, blankId = null) {
  const undercoverSet = new Set(undercoverIds);
  room.civilianWord = 'apple';
  room.undercoverWord = 'pear';
  room.players.forEach((player) => {
    if (undercoverSet.has(player.id)) {
      player.role = 'undercover';
      player.word = room.undercoverWord;
    } else if (player.id === blankId) {
      player.role = 'blank';
      player.word = null;
    } else {
      player.role = 'civilian';
      player.word = room.civilianWord;
    }
    player.alive = true;
    player.vote = null;
    player.speech = null;
  });
}

function submitAllSpeeches(room) {
  room.startSpeaking();
  assert.equal(room.phase, PHASE.SPEAKING);

  for (const playerId of [...room.speakingOrder]) {
    const result = room.submitSpeech(playerId, {
      type: 'text',
      content: `${playerId} speaks`,
    });

    if (playerId === room.speakingOrder.at(-1)) {
      assert.equal(result.allDone, true);
    }
  }

  assert.equal(room.phase, PHASE.VOTING);
}

function voteOut(room, targetId) {
  assert.equal(room.phase, PHASE.VOTING);

  const alivePlayers = room.players.filter((player) => player.alive);
  const fallbackTarget = alivePlayers.find((player) => player.id !== targetId)?.id;
  let finalResult;

  for (const voter of alivePlayers) {
    finalResult = room.submitVote(voter.id, voter.id === targetId ? fallbackTarget : targetId);
  }

  assert.equal(room.players.find((player) => player.id === targetId).alive, false);
  assert.equal(finalResult.voteResult.eliminated.id, targetId);

  return finalResult;
}

function submitVotes(room, votesByPlayer) {
  let finalResult;
  for (const [playerId, targetId] of Object.entries(votesByPlayer)) {
    finalResult = room.submitVote(playerId, targetId);
  }
  return finalResult;
}

function expectRoleCounts(room, { civilians, undercovers, blanks = 0 }) {
  const aliveCivilian = room.players.filter((player) => player.alive && player.role === 'civilian').length;
  const aliveUndercover = room.players.filter((player) => player.alive && player.role === 'undercover').length;
  const aliveBlank = room.players.filter((player) => player.alive && player.role === 'blank').length;

  assert.equal(aliveCivilian, civilians);
  assert.equal(aliveUndercover, undercovers);
  assert.equal(aliveBlank, blanks);
}

test('4-player 1-undercover game protects change-word, vote, guess, and civilian win flow', () => {
  const room = createStartedRoom({ playerCount: 4, undercoverCount: 1 });
  forceRoles(room, ['p4']);

  assert.equal(room.undercoverCount, 1);
  assert.equal(room.getPublicState().changeWordNeeded, 3);

  assert.deepEqual(room.voteChangeWord('p1'), { passed: false, total: 4, needed: 3, current: 1 });
  assert.deepEqual(room.voteChangeWord('p2'), { passed: false, total: 4, needed: 3, current: 2 });
  assert.deepEqual(room.voteChangeWord('p3'), { passed: true, total: 4, needed: 3, current: 3 });
  assert.equal(room.wordChangeCount, 1);
  assert.equal(room.changeWordVotes.size, 0);
  assert.equal(room.phase, PHASE.PLAYING);

  assert.deepEqual(room.voteChangeWord('p1'), { passed: false, total: 4, needed: 3, current: 1 });
  assert.deepEqual(room.voteChangeWord('p2'), { passed: false, total: 4, needed: 3, current: 2 });
  assert.deepEqual(room.voteChangeWord('p3'), { passed: true, total: 4, needed: 3, current: 3 });
  assert.equal(room.wordChangeCount, 2);

  forceRoles(room, ['p4']);
  submitAllSpeeches(room);
  const voteResult = voteOut(room, 'p4');

  assert.equal(voteResult.gameOver.guessRequired, true);
  assert.equal(voteResult.gameOver.guessingUndercoverId, 'p4');
  assert.equal(room.phase, PHASE.UNDERCOVER_GUESS);

  const guessResult = room.submitUndercoverGuess('p4', 'banana');
  assert.equal(guessResult.correct, false);
  assert.equal(guessResult.winner, 'civilian');
  assert.equal(room.phase, PHASE.GAME_OVER);
  assert.equal(room.winner, 'civilian');
  assert.equal(room.getPublicState().civilianWord, 'apple');
});

test('10-player 3-undercover game protects multi-round undercover guess flow', () => {
  const room = createStartedRoom({ playerCount: 10, undercoverCount: 3 });
  forceRoles(room, ['p8', 'p9', 'p10']);

  assert.equal(room.undercoverCount, 3);
  assert.equal(room.getMaxUndercoverCount(), 4);
  expectRoleCounts(room, { civilians: 7, undercovers: 3 });

  submitAllSpeeches(room);
  let voteResult = voteOut(room, 'p8');
  assert.equal(voteResult.gameOver.guessRequired, true);
  assert.equal(room.phase, PHASE.UNDERCOVER_GUESS);

  let guessResult = room.submitUndercoverGuess('p8', 'wrong');
  assert.equal(guessResult.correct, false);
  assert.equal(guessResult.winner, null);
  assert.equal(room.phase, PHASE.RESULT);
  expectRoleCounts(room, { civilians: 7, undercovers: 2 });

  submitAllSpeeches(room);
  voteResult = voteOut(room, 'p1');
  assert.equal(voteResult.gameOver, null);
  assert.equal(room.phase, PHASE.RESULT);
  expectRoleCounts(room, { civilians: 6, undercovers: 2 });

  submitAllSpeeches(room);
  voteResult = voteOut(room, 'p9');
  assert.equal(voteResult.gameOver.guessRequired, true);
  assert.equal(room.phase, PHASE.UNDERCOVER_GUESS);

  guessResult = room.timeoutUndercoverGuess();
  assert.equal(guessResult.timeout, true);
  assert.equal(guessResult.winner, null);
  assert.equal(room.phase, PHASE.RESULT);
  expectRoleCounts(room, { civilians: 6, undercovers: 1 });

  submitAllSpeeches(room);
  voteResult = voteOut(room, 'p10');
  assert.equal(voteResult.gameOver.guessRequired, true);
  assert.equal(room.phase, PHASE.UNDERCOVER_GUESS);

  guessResult = room.submitUndercoverGuess('p10', 'apple');
  assert.equal(guessResult.correct, true);
  assert.equal(guessResult.winner, 'undercover');
  assert.equal(room.phase, PHASE.GAME_OVER);
  assert.equal(room.winner, 'undercover');
  assert.equal(room.getPublicState().undercoverWord, 'pear');
});

test('tie votes create numbered battle speech rounds until one player is eliminated', () => {
  const room = createStartedRoom({ playerCount: 4, undercoverCount: 1 });
  forceRoles(room, ['p4']);

  submitAllSpeeches(room);
  let voteResult = submitVotes(room, {
    p1: 'p3',
    p2: 'p4',
    p3: 'p4',
    p4: 'p3',
  });

  assert.equal(voteResult.tieBattle, true);
  assert.equal(room.phase, PHASE.SPEAKING);
  assert.equal(room.currentSpeechLabel, '平票battle-1');
  assert.deepEqual(new Set(room.battleCandidates), new Set(['p3', 'p4']));
  assert.equal(room.speechHistory.at(-1).label, '第1轮');

  for (const playerId of [...room.speakingOrder]) {
    room.submitSpeech(playerId, { type: 'text', content: `${playerId} battle 1` });
  }
  assert.equal(room.phase, PHASE.VOTING);

  voteResult = submitVotes(room, {
    p1: 'p3',
    p2: 'p4',
    p3: 'p4',
    p4: 'p3',
  });

  assert.equal(voteResult.tieBattle, true);
  assert.equal(room.phase, PHASE.SPEAKING);
  assert.equal(room.currentSpeechLabel, '平票battle-2');
  assert.equal(room.speechHistory.at(-1).label, '平票battle-1');

  for (const playerId of [...room.speakingOrder]) {
    room.submitSpeech(playerId, { type: 'text', content: `${playerId} battle 2` });
  }
  assert.equal(room.phase, PHASE.VOTING);

  voteResult = submitVotes(room, {
    p1: 'p4',
    p2: 'p4',
    p3: 'p4',
    p4: 'p3',
  });

  assert.equal(voteResult.voteResult.tie, false);
  assert.equal(voteResult.voteResult.eliminated.id, 'p4');
  assert.equal(voteResult.gameOver.guessRequired, true);
  assert.equal(room.phase, PHASE.UNDERCOVER_GUESS);
});

test('blank role: 5-player game assigns one blank with null word and aggregates non-civilian state', () => {
  const room = createStartedRoom({ playerCount: 5, undercoverCount: 1, blankEnabled: true });

  assert.equal(room.blankEnabled, true);
  const undercovers = room.players.filter((p) => p.role === 'undercover');
  const blanks = room.players.filter((p) => p.role === 'blank');
  const civilians = room.players.filter((p) => p.role === 'civilian');

  assert.equal(undercovers.length, 1);
  assert.equal(blanks.length, 1);
  assert.equal(civilians.length, 3);
  assert.equal(blanks[0].word, null);
  assert.equal(undercovers[0].word, room.undercoverWord);

  const publicState = room.getPublicState();
  assert.equal(publicState.blankEnabled, true);
  assert.equal(publicState.aliveCivilianCount, 3);
  assert.equal(publicState.aliveNonCivilianCount, 2);
  assert.equal(publicState.aliveUndercoverCount, undefined);
  // 活人阶段不暴露身份
  publicState.players.forEach((p) => {
    assert.equal(p.role, null);
  });
});

test('blank role: max undercover count reserves a slot for blank', () => {
  const room = new Room('blank-max', 'p1');
  for (let i = 1; i <= 7; i++) {
    room.addPlayer(`p${i}`, `Player ${i}`);
  }

  assert.equal(room.getMaxUndercoverCount(), 3);
  room.setBlankEnabled(true);
  assert.equal(room.getMaxUndercoverCount(), 2);
  // 已设置的 undercoverCount 应被收紧
  room.setUndercoverCount(3);
  assert.equal(room.undercoverCount, 2);
});

test('blank role: cannot start with fewer than 5 players when blank enabled', () => {
  const room = new Room('blank-small', 'p1');
  for (let i = 1; i <= 4; i++) {
    room.addPlayer(`p${i}`, `Player ${i}`);
    room.setReady(`p${i}`, true);
  }
  room.setBlankEnabled(true);
  const result = room.startGame();
  assert.ok(result.error);
  assert.equal(room.phase, PHASE.WAITING);
});

test('blank role: blank correct guess wins as independent blank camp', () => {
  const room = createStartedRoom({ playerCount: 5, undercoverCount: 1, blankEnabled: true });
  forceRoles(room, ['p5'], 'p4');
  expectRoleCounts(room, { civilians: 3, undercovers: 1, blanks: 1 });

  submitAllSpeeches(room);
  const voteResult = voteOut(room, 'p4');

  assert.equal(voteResult.gameOver.guessRequired, true);
  assert.equal(voteResult.gameOver.guessingUndercoverId, 'p4');
  assert.equal(room.phase, PHASE.UNDERCOVER_GUESS);

  const guessResult = room.submitUndercoverGuess('p4', 'apple');
  assert.equal(guessResult.correct, true);
  assert.equal(guessResult.winner, 'blank');
  assert.equal(room.phase, PHASE.GAME_OVER);
  assert.equal(room.winner, 'blank');
});

test('blank role: 5-player game does not end after eliminating 1 civilian (alive 4 > threshold 2)', () => {
  const room = createStartedRoom({ playerCount: 5, undercoverCount: 1, blankEnabled: true });
  forceRoles(room, ['p5'], 'p4'); // p1,p2,p3 civilians; p5 undercover; p4 blank

  submitAllSpeeches(room);
  const voteResult = voteOut(room, 'p1');

  assert.equal(voteResult.gameOver, null);
  assert.equal(room.phase, PHASE.RESULT);
  assert.equal(room.winner, null);
});

test('blank role: undercover wins only when alive count reaches threshold (<7 -> 2)', () => {
  const room = createStartedRoom({ playerCount: 5, undercoverCount: 1, blankEnabled: true });
  forceRoles(room, ['p5'], 'p4');

  // 淘汰平民 p1 → alive=4
  submitAllSpeeches(room);
  let voteResult = voteOut(room, 'p1');
  assert.equal(voteResult.gameOver, null);

  // 淘汰平民 p2 → alive=3，仍未到阈值 2
  submitAllSpeeches(room);
  voteResult = voteOut(room, 'p2');
  assert.equal(voteResult.gameOver, null);

  // 淘汰平民 p3 → alive=2 (p4 白板, p5 卧底)，触发卧底胜
  submitAllSpeeches(room);
  voteResult = voteOut(room, 'p3');
  assert.equal(voteResult.gameOver?.winner, 'undercover');
  assert.equal(room.phase, PHASE.GAME_OVER);
  assert.equal(room.winner, 'undercover');
});

test('blank role: undercover-win threshold is 3 when player count >= 7', () => {
  const room = createStartedRoom({ playerCount: 8, undercoverCount: 1, blankEnabled: true });
  forceRoles(room, ['p8'], 'p7');
  assert.equal(room.getUndercoverWinThreshold(), 3);

  // 依次淘汰 5 名平民，alive 从 8 → 7 → 6 → 5 → 4 → 3
  for (const targetId of ['p1', 'p2', 'p3', 'p4']) {
    submitAllSpeeches(room);
    const voteResult = voteOut(room, targetId);
    assert.equal(voteResult.gameOver, null, `${targetId} 淘汰后游戏不应结束`);
  }

  // 淘汰 p5 后 alive=3（p6 平民、p7 白板、p8 卧底），触发卧底胜
  submitAllSpeeches(room);
  const voteResult = voteOut(room, 'p5');
  assert.equal(voteResult.gameOver?.winner, 'undercover');
  assert.equal(room.winner, 'undercover');
});

test('blank role: blank wins independently when undercover is eliminated and blank survives', () => {
  const room = createStartedRoom({ playerCount: 8, undercoverCount: 1, blankEnabled: true });
  forceRoles(room, ['p8'], 'p7');

  submitAllSpeeches(room);
  const voteResult = voteOut(room, 'p8'); // 淘汰唯一卧底
  assert.equal(voteResult.gameOver?.guessRequired, true);
  assert.equal(room.phase, PHASE.UNDERCOVER_GUESS);

  // 卧底猜错 → 此时所有卧底已死、白板还活 → 白板独胜
  const guessResult = room.submitUndercoverGuess('p8', 'wrong-word');
  assert.equal(guessResult.correct, false);
  assert.equal(guessResult.winner, 'blank');
  assert.equal(room.winner, 'blank');
  assert.equal(room.phase, PHASE.GAME_OVER);
});

test('blank role: undercover beats blank when both survive at threshold', () => {
  // 5 人局：1 卧 1 白 3 平。淘汰 3 平后 alive=2 (1 卧 1 白)，按社区规则卧底胜（白板未触发独胜）
  const room = createStartedRoom({ playerCount: 5, undercoverCount: 1, blankEnabled: true });
  forceRoles(room, ['p5'], 'p4');

  for (const targetId of ['p1', 'p2']) {
    submitAllSpeeches(room);
    voteOut(room, targetId);
  }

  submitAllSpeeches(room);
  const voteResult = voteOut(room, 'p3');
  assert.equal(voteResult.gameOver?.winner, 'undercover');
  assert.equal(room.winner, 'undercover');
});

test('blank role: blank wrong guess with surviving undercover continues game', () => {
  const room = createStartedRoom({ playerCount: 5, undercoverCount: 1, blankEnabled: true });
  forceRoles(room, ['p5'], 'p4');

  submitAllSpeeches(room);
  voteOut(room, 'p4');
  assert.equal(room.phase, PHASE.UNDERCOVER_GUESS);

  const guessResult = room.submitUndercoverGuess('p4', 'banana');
  assert.equal(guessResult.correct, false);
  assert.equal(guessResult.winner, null);
  assert.equal(room.phase, PHASE.RESULT);
  expectRoleCounts(room, { civilians: 3, undercovers: 1, blanks: 0 });
});

test('blank role: civilians win when both blank and undercover are eliminated', () => {
  const room = createStartedRoom({ playerCount: 5, undercoverCount: 1, blankEnabled: true });
  forceRoles(room, ['p5'], 'p4');

  // 第一轮淘汰白板 p4，猜错继续
  submitAllSpeeches(room);
  voteOut(room, 'p4');
  room.submitUndercoverGuess('p4', 'banana');
  assert.equal(room.phase, PHASE.RESULT);

  // 第二轮淘汰卧底 p5，猜错 → 平民胜
  submitAllSpeeches(room);
  voteOut(room, 'p5');
  assert.equal(room.phase, PHASE.UNDERCOVER_GUESS);

  const guessResult = room.submitUndercoverGuess('p5', 'wrong');
  assert.equal(guessResult.correct, false);
  assert.equal(room.phase, PHASE.GAME_OVER);
  assert.equal(room.winner, 'civilian');
});

test('blank role: final_undercover mode skips guess until last non-civilian eliminated', () => {
  const room = createStartedRoom({
    playerCount: 7, undercoverCount: 1, blankEnabled: true, guessMode: 'final_undercover',
  });
  forceRoles(room, ['p7'], 'p6');

  // 第一轮淘汰白板 p6，但仍有卧底 p7 → 不触发猜词
  submitAllSpeeches(room);
  let voteResult = voteOut(room, 'p6');
  assert.equal(voteResult.gameOver, null);
  assert.equal(room.phase, PHASE.RESULT);

  // 第二轮淘汰最后非平民卧底 p7 → 触发猜词
  submitAllSpeeches(room);
  voteResult = voteOut(room, 'p7');
  assert.equal(voteResult.gameOver.guessRequired, true);
  assert.equal(room.phase, PHASE.UNDERCOVER_GUESS);
});

test('blank role: changeWords keeps blank word null', () => {
  const room = createStartedRoom({ playerCount: 5, undercoverCount: 1, blankEnabled: true });
  forceRoles(room, ['p5'], 'p4');

  // 触发换词
  for (const id of ['p1', 'p2', 'p3']) {
    room.voteChangeWord(id);
  }
  assert.equal(room.wordChangeCount, 1);

  const blank = room.players.find((p) => p.id === 'p4');
  assert.equal(blank.word, null);
  const undercover = room.players.find((p) => p.id === 'p5');
  assert.equal(undercover.word, room.undercoverWord);
});
