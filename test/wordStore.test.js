const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 用临时文件作为投稿存储，避免污染真实数据
const TMP_FILE = path.join(os.tmpdir(), `wuc-contrib-test-${process.pid}.json`);
process.env.CONTRIBUTED_WORDS_FILE = TMP_FILE;

const wordStore = require('../server/wordStore');

beforeEach(() => {
  // 清空临时文件并重载，保证每个用例独立
  if (fs.existsSync(TMP_FILE)) fs.unlinkSync(TMP_FILE);
  wordStore.reload();
});

after(() => {
  if (fs.existsSync(TMP_FILE)) fs.unlinkSync(TMP_FILE);
});

test('接受合法的一组词并入库', async () => {
  const res = await wordStore.addContributions([['苹果手机', '安卓手机']], '小明');
  assert.strictEqual(res.added, 1);
  assert.strictEqual(res.skipped.length, 0);
  const list = wordStore.listContributions();
  assert.strictEqual(list.length, 1);
  assert.deepStrictEqual(list[0].pair, ['苹果手机', '安卓手机']);
  assert.strictEqual(list[0].contributor, '小明');
  assert.ok(list[0].createdAt, '应记录创建时间');
});

test('拒绝含空白词的组', async () => {
  const res = await wordStore.addContributions([['有效', '   ']], '小明');
  assert.strictEqual(res.added, 0);
  assert.strictEqual(res.skipped.length, 1);
  assert.strictEqual(res.skipped[0].index, 0);
});

test('拒绝不是正好两个词的组', async () => {
  const res = await wordStore.addContributions([['只有一个'], ['一', '二', '三']], '小明');
  assert.strictEqual(res.added, 0);
  assert.strictEqual(res.skipped.length, 2);
});

test('拒绝单词超过20字的组', async () => {
  const longWord = '字'.repeat(21);
  const res = await wordStore.addContributions([[longWord, '正常']], '小明');
  assert.strictEqual(res.added, 0);
  assert.strictEqual(res.skipped.length, 1);
});

test('拒绝组内两词相同', async () => {
  const res = await wordStore.addContributions([['一样', '一样']], '小明');
  assert.strictEqual(res.added, 0);
  assert.strictEqual(res.skipped.length, 1);
});

test('与内置词库无序去重', async () => {
  // words.js 内含 ['抖音','快手']，反序也应判重
  const res = await wordStore.addContributions([['快手', '抖音']], '小明');
  assert.strictEqual(res.added, 0);
  assert.strictEqual(res.skipped.length, 1);
  assert.match(res.skipped[0].reason, /重复/);
});

test('与已投稿词无序去重', async () => {
  await wordStore.addContributions([['番茄', '西红柿']], '小明');
  const res = await wordStore.addContributions([['西红柿', '番茄']], '小红');
  assert.strictEqual(res.added, 0);
  assert.strictEqual(res.skipped.length, 1);
});

test('同一批次内部去重', async () => {
  const res = await wordStore.addContributions([['左', '右'], ['右', '左']], '小明');
  assert.strictEqual(res.added, 1);
  assert.strictEqual(res.skipped.length, 1);
});

test('批量部分成功：合法入库，非法跳过', async () => {
  const res = await wordStore.addContributions([
    ['白天', '黑夜'],   // ok
    ['坏', ''],         // 空词
    ['猫', '狗'],       // ok
  ], '小明');
  assert.strictEqual(res.added, 2);
  assert.strictEqual(res.skipped.length, 1);
  assert.strictEqual(res.skipped[0].index, 1);
  assert.strictEqual(wordStore.listContributions().length, 2);
});

test('持久化往返：写入后重载可读回', async () => {
  await wordStore.addContributions([['夏天', '冬天']], '小明');
  wordStore.reload();
  const list = wordStore.listContributions();
  assert.strictEqual(list.length, 1);
  assert.deepStrictEqual(list[0].pair, ['夏天', '冬天']);
});

test('addContributions 异步持久化：返回 Promise，不在请求线程同步阻塞写盘', async () => {
  const ret = wordStore.addContributions([['南极', '北极']], '小明');
  assert.strictEqual(typeof ret.then, 'function', 'addContributions 应返回 Promise（异步写盘，避免阻塞事件循环）');
  const res = await ret;
  assert.strictEqual(res.added, 1);
  // 内存状态应同步更新（去重立即生效，不依赖写盘完成）
  assert.strictEqual(wordStore.listContributions().length, 1);
});

test('getRandomWordPair 返回平民词/卧底词/投稿人三字段', () => {
  const pair = wordStore.getRandomWordPair();
  assert.ok(pair.civilianWord);
  assert.ok(pair.undercoverWord);
  assert.ok('contributor' in pair, '应包含 contributor 字段');
});
