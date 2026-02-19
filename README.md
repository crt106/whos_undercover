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
