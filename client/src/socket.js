import { io } from 'socket.io-client';

// 开发模式下也通过 Vite proxy 连接，这样手机访问不会有跨域和 localhost 问题
const socket = io('/game', {
  autoConnect: false,
  transports: ['polling', 'websocket'],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  auth: {
    get sessionId() {
      return localStorage.getItem('gameSessionId');
    }
  }
});

export default socket;
