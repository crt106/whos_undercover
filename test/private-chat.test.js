const test = require('node:test');
const assert = require('node:assert/strict');

const { Room, PHASE } = require('../server/game');

function makeRoom(playerCount = 4) {
  const room = new Room('pc-test', 'p1');
  for (let i = 1; i <= playerCount; i++) {
    room.addPlayer(`p${i}`, `Player ${i}`);
    room.setReady(`p${i}`, true);
  }
  return room;
}

test('private chat: basic send & history filtering', () => {
  const room = makeRoom();
  const a = room.sendPrivateMessage('p1', 'p2', 'hello p2');
  assert.equal(a.error, undefined);
  assert.ok(a.message?.id);
  assert.equal(a.message.fromId, 'p1');
  assert.equal(a.message.toId, 'p2');
  assert.equal(a.message.content, 'hello p2');

  // p3 → p4 不应出现在 p1 的视图里
  room.sendPrivateMessage('p3', 'p4', 'hi p4');

  const p1View = room.getPrivateMessagesFor('p1');
  assert.equal(p1View.length, 1);
  assert.equal(p1View[0].content, 'hello p2');

  const p2View = room.getPrivateMessagesFor('p2');
  assert.equal(p2View.length, 1);

  const p3View = room.getPrivateMessagesFor('p3');
  assert.equal(p3View.length, 1);
  assert.equal(p3View[0].toId, 'p4');
});

test('private chat: cannot send to self / empty / too long', () => {
  const room = makeRoom();
  assert.match(room.sendPrivateMessage('p1', 'p1', 'x').error, /自己/);
  assert.match(room.sendPrivateMessage('p1', 'p2', '   ').error, /空/);
  assert.match(room.sendPrivateMessage('p1', 'p2', 'a'.repeat(201)).error, /≤200/);
  // 200 字应该恰好通过
  const r = room.sendPrivateMessage('p1', 'p2', 'a'.repeat(200));
  assert.equal(r.error, undefined);
});

test('private chat: sender or target must exist in room', () => {
  const room = makeRoom();
  assert.match(room.sendPrivateMessage('ghost', 'p2', 'hi').error, /发送者/);
  assert.match(room.sendPrivateMessage('p1', 'ghost', 'hi').error, /对方/);
});

test('private chat: eliminated player cannot send but can receive', () => {
  const room = makeRoom();
  const dead = room.players.find(p => p.id === 'p1');
  dead.alive = false;

  const sent = room.sendPrivateMessage('p1', 'p2', 'I am ghost');
  assert.match(sent.error, /淘汰/);

  // 其他活人可以给他发，他能收到（即出现在他的视图里）
  const recv = room.sendPrivateMessage('p2', 'p1', 'rip');
  assert.equal(recv.error, undefined);
  assert.equal(room.getPrivateMessagesFor('p1').length, 1);
});

test('private chat: cannot send when phase is game_over', () => {
  const room = makeRoom();
  room.phase = PHASE.GAME_OVER;
  const r = room.sendPrivateMessage('p1', 'p2', 'gg');
  assert.match(r.error, /已结束/);
});

test('private chat: getPublicState hides messages until game_over', () => {
  const room = makeRoom();
  room.sendPrivateMessage('p1', 'p2', 'secret');
  // waiting 阶段
  assert.equal(room.getPublicState().privateMessages, null);

  room.phase = PHASE.SPEAKING;
  assert.equal(room.getPublicState().privateMessages, null);

  room.phase = PHASE.GAME_OVER;
  const state = room.getPublicState();
  assert.equal(Array.isArray(state.privateMessages), true);
  assert.equal(state.privateMessages.length, 1);
  assert.equal(state.privateMessages[0].content, 'secret');
});

test('private chat: resetForNewGame and abortGame clear messages', () => {
  const room = makeRoom();
  room.sendPrivateMessage('p1', 'p2', 'm1');
  room.sendPrivateMessage('p3', 'p4', 'm2');
  assert.equal(room.privateMessages.length, 2);

  room.resetForNewGame();
  assert.equal(room.privateMessages.length, 0);

  room.sendPrivateMessage('p1', 'p2', 'm3');
  assert.equal(room.privateMessages.length, 1);

  room.abortGame('p2');
  assert.equal(room.privateMessages.length, 0);
});

test('private chat: message snapshot includes round/phase/speechLabel', () => {
  const room = makeRoom();
  room.round = 2;
  room.phase = PHASE.VOTING;
  room.currentSpeechLabel = '平票battle-1';
  room.currentSpeechKey = 'round-2-battle-1';

  const r = room.sendPrivateMessage('p1', 'p2', 'sync up');
  assert.equal(r.message.round, 2);
  assert.equal(r.message.phase, PHASE.VOTING);
  assert.equal(r.message.speechLabel, '平票battle-1');
  assert.equal(r.message.speechKey, 'round-2-battle-1');
});
