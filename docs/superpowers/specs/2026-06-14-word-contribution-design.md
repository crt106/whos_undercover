# 玩家投稿词汇 设计文档

日期：2026-06-14

## 目标

允许通过密码校验、并在主页填写了昵称（ID）的玩家投稿词汇组（平民词 + 卧底词），
投稿在部署机器上本地持久化，并立即进入游戏抽词池。投稿支持一次输入一组、页面批量添加多组。
游戏结束时，若本局词语来自投稿，结算页展示投稿人。

## 非目标

- 不引入数据库（沿用项目「纯内存 + 文件」约定，投稿单独落 JSON 文件）。
- 不做投稿审核流程，投稿即生效。
- 不做前端「投稿列表」页面（投稿人仅在用到该词的对局结束时随局展示）。

## 数据存储

- 新文件 `server/contributed-words.json`（运行时数据，加入 `.gitignore`，与 `server/uploads/` 同类）。
- 结构：
  ```json
  [
    { "pair": ["平民词", "卧底词"], "contributor": "昵称", "createdAt": "2026-06-14T10:00:00.000Z" }
  ]
  ```
- 服务启动时读入内存；每次投稿成功后整文件覆盖写回。
- 文件不存在或解析失败时降级为空数组并打日志，不崩溃。

## `server/wordStore.js`

统一管理「内置词库 + 投稿词库」合并池与持久化。

- `words.js` 额外导出内置 `wordPairs` 数组（保留 `getRandomWordPair` 兼容旧引用）。
- wordStore 导出：
  - `getRandomWordPair()`：从 内置 + 投稿 合并池随机抽取，保留原有「随机决定正/反词」逻辑；
    返回 `{ civilianWord, undercoverWord, contributor }`，内置词 `contributor` 为 `null`。
  - `addContributions(groups, contributor)`：校验 + 去重 + 持久化，逐组返回结果。
  - `listContributions()`：返回内存中投稿数组（内部/测试用，不暴露前端列表页）。
- 投稿词文件路径通过环境变量 `CONTRIBUTED_WORDS_FILE` 覆盖（默认 `server/contributed-words.json`），便于测试用临时文件。
- `game.js` 两处 `getRandomWordPair`（startGame、voteChangeWord）改为从 `wordStore` 导入。

## 校验规则

逐组校验，单组失败不影响其它组：

- 每组必须正好两个词，去首尾空白后均非空。
- 单个词长度 ≤ 20 字（超长拒绝）。
- 组内两个词不能相同。
- 去重：与「内置 + 已投稿 + 本批已接受」按**无序**比较（`[a,b]` 与 `[b,a]` 视为重复）。

返回 `{ added, skipped: [{ index, reason }], total }`，`total` 为合并池词组总数。

## HTTP API

均经 `requireAuth`（校验 `X-Session-Id`）。

- `POST /api/words/contribute`
  - body：`{ contributor: string, groups: [[w1, w2], ...] }`
  - 校验 `contributor` 非空、`groups` 为非空数组。
  - 返回：`{ added, skipped, total }`。

## 投稿人随局揭示

- `Room` 新增 `this.wordContributor`（默认 `null`）。
- `startGame` / `voteChangeWord` 抽词时记录 `wordContributor`。
- `resetForNewGame` / `abortGame` 清空。
- `getPublicState()` 增加 `wordContributor: phase === GAME_OVER ? this.wordContributor : null`
  （与 `civilianWord` 同样仅在游戏结束时暴露，避免泄露）。
- `GameResult.jsx`：普通结束块与猜词结束块中，若 `roomState.wordContributor` 存在，
  展示一行「本局词语由 XX 投稿 ✨」。

## 前端（`Home.jsx`）

- 主页新增按钮 `✏️ 投稿词汇`，与「测试麦克风」并列；未填昵称时禁用（昵称即投稿者 ID）。
- 投稿模式（`mode === 'contribute'`）：
  - 多行输入，每行两个输入框（平民词 / 卧底词）+ 删除按钮。
  - 「+ 添加一组」追加空行。
  - 「提交」按钮：带 `X-Session-Id` 头与 `contributor=昵称` 调 POST，提交后展示「成功 N 组 / 跳过 M 组及原因」。
  - 「返回」回到主页。

## 测试

- `test/wordStore.test.js`（env 覆盖路径到临时文件）：
  - 校验：空词、超长、组内同词被拒。
  - 无序去重（含与内置词、批内重复）。
  - 批量部分成功（成功入库、失败带原因）。
  - 持久化往返（写入后重新加载可读回）。

## 验证

```bash
pnpm test
pnpm run build
```
