# 🕵️ 谁是卧底 - 在线多人推理游戏

一个基于 Web 的「谁是卧底」在线多人游戏，支持文字和语音发言，实时对战。

## 功能特性

- 🎮 创建/加入房间，6位数房间号，最多12人
- 🗣️ 支持文字和语音两种发言方式
- 🗳️ 实时投票淘汰机制
- 🔄 游戏中投票换词
- 📱 移动端适配，随时随地开玩
- 🔌 断线重连支持，游戏中掉线60秒等待

## 技术栈

- 前端：React 18 + Vite + Tailwind CSS
- 后端：Express + Socket.IO
- 通信：WebSocket 实时双向通信
- 语音：Web Audio API 录制 + 服务端存储

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
VITE_GATE_PASSWORD=your_password_here
```

开发模式下后端运行在 `http://localhost:3001`，前端运行在 `http://localhost:5173`。

## 游戏规则

1. 每人获得一个词语，卧底的词与其他人不同但相近
2. 轮流用语言描述自己的词，不能直接说出词语
3. 每轮投票选出最可疑的人，被投出者出局
4. 平民投出所有卧底则胜利，反之卧底胜利

## 项目结构

```
├── client/                # 前端 React 应用
│   └── src/
│       ├── components/    # 游戏组件（玩家卡片、投票面板、语音录制等）
│       ├── pages/         # 页面（首页、房间、游戏）
│       └── socket.js      # Socket.IO 客户端
├── server/
│   ├── index.js           # Express + Socket.IO 服务端
│   ├── game.js            # 游戏房间逻辑
│   └── words.js           # 词库（120+ 词对）
└── package.json
```

## License

MIT
