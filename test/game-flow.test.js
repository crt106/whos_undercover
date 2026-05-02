const test = require('node:test');
const assert = require('node:assert/strict');

const { Room, PHASE } = require('../server/game');

function createStartedRoom({ playerCount, undercoverCount, guessMode = 'every_undercover' }) {
  const room = new Room(`test-${playerCount}-${undercoverCount}`, 'p1');

  for (let i = 1; i <= playerCount; i++) {
    const id = `p${i}`;
    const result = room.addPlayer(id, `Player ${i}`);
    assert.equal(result.success, true);
    room.setReady(id, true);
  }

  room.setUndercoverCount(undercoverCount);
  room.setUndercoverGuessMode(guessMode);

  const result = room.startGame();
  assert.equal(result.success, true);
  assert.equal(room.phase, PHASE.PLAYING);

  return room;
}

function forceRoles(room, undercoverIds) {
  const undercoverSet = new Set(undercoverIds);
  room.civilianWord = 'apple';
  room.undercoverWord = 'pear';
  room.players.forEach((player) => {
    player.role = undercoverSet.has(player.id) ? 'undercover' : 'civilian';
    player.word = player.role === 'undercover' ? room.undercoverWord : room.civilianWord;
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

function expectRoleCounts(room, { civilians, undercovers }) {
  const aliveCivilian = room.players.filter((player) => player.alive && player.role === 'civilian').length;
  const aliveUndercover = room.players.filter((player) => player.alive && player.role === 'undercover').length;

  assert.equal(aliveCivilian, civilians);
  assert.equal(aliveUndercover, undercovers);
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
