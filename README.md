# 🕵️ 谁是卧底 - 在线多人推理游戏

一个基于 Web 的「谁是卧底」在线多人游戏，支持文字和语音发言，实时对战。

## 功能特性

- 🎮 创建/加入房间，6位数房间号，最多12人
- 🗣️ 支持文字和语音两种发言方式
- 🎤 麦克风测试功能，进房前可提前检测
- 🗳️ 实时投票淘汰机制
- 🔄 游戏中投票换词（需半数以上同意，每局限一次）
- 🕵️ **卧底最后猜词**：最后一个卧底被淘汰时获得 30 秒猜词机会，猜对平民词即可翻盘
- 📜 **多轮发言历史**：横向 Tab 保留所有轮次发言记录，查看历史时自动跳回最新轮
- 📱 移动端适配，支持长按录音
- 🔌 断线重连支持，游戏中掉线自动等待
- 🔐 密码保护，支持 URL 参数传递密码
- 📋 房间列表浏览，可搜索房主或房间号
- 👁️ **观战系统**：房间列表展示游戏中的房间，非玩家可申请观战，房主审批（10秒自动拒绝）后进入旁观视角
- ⏱️ **房间自动回收**：等待中或游戏结束状态超过 1 小时无活动，自动关闭房间并通知所有人
- 🔴 **房主强制关闭**：游戏进行中房主可一键关闭房间，二次确认后立即解散
- 🔔 **Webhook 通知**：游戏开始时可向外部平台发送通知，方便其他用户观战

## 技术栈

- 前端：React 18 + Vite + Tailwind CSS
- 后端：Express + Socket.IO
- 通信：WebSocket 实时双向通信
- 语音：MediaRecorder API 录制 + 服务端存储

## 快速开始

### 使用 pnpm（推荐）

```bash
# 安装 pnpm（如果还没有）
npm install -g pnpm

# 安装所有依赖
pnpm install

# 开发模式（同时启动前后端）
pnpm run dev

# 生产构建 & 启动
pnpm start
```

### 使用 npm

```bash
# 安装依赖
npm install
npm install --prefix client

# 开发模式（同时启动前后端）
npm run dev

# 生产构建 & 启动
npm start
```

### 环境配置

创建 `.env` 文件并设置访问密码：

```bash
# 复制示例配置
cp .env.example .env

# 编辑 .env 文件，设置你的密码
GAME_PASSWORD=your_password_here
```

也可以通过 URL 参数访问：`http://your-domain/?password=your_password` 或 `?pwd=your_password`

### Webhook 配置

项目根目录的 `webhook.config.json` 用于配置游戏事件的外部通知推送，支持两种渠道：通用 HTTP 和 NapCat QQ 群消息。

```bash
# 复制示例配置
cp webhook.config.example.json webhook.config.json
# 编辑 webhook.config.json，按需开启并填写参数
```

```json
{
  "http": {
    "enabled": false,
    "url": "https://example.com/webhook",
    "timeout": 5000,
    "headers": { "Content-Type": "application/json" },
    "events": {
      "game_start": { "enabled": true }
    }
  },
  "napcat_qq": {
    "enabled": false,
    "base_url": "http://127.0.0.1:6099",
    "token": "your_napcat_token_here",
    "group_id": "123456789",
    "timeout": 5000,
    "message_template": "🕵️ 谁是卧底开局通知\n房间号: {{roomId}}\n房主: {{hostName}}\n人数: {{playerCount}}\n卧底数: {{undercoverCount}}\n开始时间: {{startTime}}",
    "events": {
      "game_start": { "enabled": true }
    }
  }
}
```

#### HTTP 通用 Webhook

| 字段 | 说明 |
|------|------|
| `http.enabled` | 总开关 |
| `http.url` | 接收地址 |
| `http.timeout` | 请求超时（毫秒） |
| `http.headers` | 自定义请求头 |
| `http.events.<事件名>.enabled` | 单个事件开关 |

`game_start` 事件请求体示例：

```json
{
  "event": "game_start",
  "timestamp": "2026-03-07T12:00:00.000Z",
  "data": {
    "roomId": "123456",
    "hostName": "玩家A",
    "playerCount": 6,
    "undercoverCount": 1,
    "startTime": "2026-03-07T12:00:00.000Z",
    "players": [
      { "name": "玩家A", "avatar": null },
      { "name": "玩家B", "avatar": null }
    ]
  }
}
```

#### NapCat QQ 群消息

通过 NapCat 的 `/send_group_msg` 接口向 QQ 群发送游戏通知。

| 字段 | 说明 |
|------|------|
| `napcat_qq.enabled` | 总开关 |
| `napcat_qq.base_url` | NapCat HTTP API 地址 |
| `napcat_qq.token` | Bearer Token 鉴权令牌 |
| `napcat_qq.group_id` | 目标 QQ 群号 |
| `napcat_qq.timeout` | 请求超时（毫秒） |
| `napcat_qq.message_template` | 消息模板，支持 `{{roomId}}` `{{hostName}}` `{{playerCount}}` `{{undercoverCount}}` `{{startTime}}` 占位符 |
| `napcat_qq.events.<事件名>.enabled` | 单个事件开关 |

开发模式下后端运行在 `http://localhost:3001`，前端运行在 `http://localhost:5173`。

## 游戏规则

1. 每人获得一个词语，卧底的词与其他人不同但相近
2. 轮流用语言描述自己的词，不能直接说出词语
3. 每轮投票选出最可疑的人，被投出者出局
4. 平民投出所有卧底则胜利；若卧底存活人数 ≥ 平民则卧底胜利
5. **卧底翻盘机制**：最后一名卧底被投票淘汰时，获得 30 秒机会猜出平民词语——猜对则卧底逆转获胜，猜错或超时则平民胜（大小写不敏感）

### 房间操作说明

| 操作 | 说明 |
|------|------|
| 准备 | 非房主玩家点击准备，房主直接开始游戏 |
| 换词 | 准备阶段，半数以上同意可更换词对（每局仅限一次） |
| 发言 | 轮到自己时描述词语，支持文字或语音，60 秒内完成 |
| 投票 | 发言全部完成后进入投票，30 秒内选出最可疑的人 |
| 历史发言 | 点击发言记录区的 Tab 可查看历史轮次，有新发言时自动跳回当前轮 |
| 观战 | 在房间列表点击「观战」申请旁观进行中的游戏，房主同意后以观战者身份进入，无法参与任何操作 |
| 关闭房间 | 房主在游戏界面右上角点击红色电源按钮，二次确认后立即关闭房间并踢出所有人 |

## 项目结构

```
├── client/                # 前端 React 应用
│   └── src/
│       ├── components/    # 游戏组件
│       │   ├── PlayerCard.jsx    # 玩家卡片
│       │   ├── VotePanel.jsx     # 投票面板
│       │   ├── VoiceRecorder.jsx # 语音录制
│       │   ├── GameResult.jsx    # 游戏结果
│       │   └── Timer.jsx         # 倒计时
│       ├── pages/
│       │   ├── Home.jsx          # 首页（创建/加入房间、麦克风测试）
│       │   ├── Room.jsx          # 房间等待页
│       │   ├── Game.jsx          # 游戏主页面
│       │   └── GatePassword.jsx  # 密码验证页
│       ├── App.jsx        # 应用入口
│       └── socket.js      # Socket.IO 客户端
├── server/
│   ├── index.js           # Express + Socket.IO 服务端
│   ├── game.js            # 游戏房间逻辑
│   └── words.js           # 词库（70+ 词对）
└── package.json
```

## License

MIT
