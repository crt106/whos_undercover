import { useState, useEffect, useCallback, useRef } from 'react';
import socket from './socket';
import GatePassword from './pages/GatePassword';
import Home from './pages/Home';
import Room from './pages/Room';
import Game from './pages/Game';

function getPlayerId() {
  let id = localStorage.getItem('wuc_player_id');
  if (!id) {
    id = 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem('wuc_player_id', id);
  }
  return id;
}

function generateSessionId() {
  return 'sess_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export default function App() {
  const [authed, setAuthed] = useState(() => {
    // 如果已有有效的 sessionId，认为已认证
    return !!localStorage.getItem('gameSessionId');
  });
  const [urlAuthPending, setUrlAuthPending] = useState(() => {
    // 检查 URL 是否携带密码参数
    const params = new URLSearchParams(window.location.search);
    return params.get('pwd') || params.get('password') || null;
  });
  const [page, setPage] = useState('home');
  const [playerId] = useState(getPlayerId);
  const [playerName, setPlayerName] = useState(localStorage.getItem('wuc_player_name') || '');
  const [roomId, setRoomId] = useState(null);
  const [roomState, setRoomState] = useState(null);
  const [myWord, setMyWord] = useState(null);
  const [myRole, setMyRole] = useState(null);
  const [voteResult, setVoteResult] = useState(null);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [disconnectNotice, setDisconnectNotice] = useState(null); // { playerName, seconds }
  const pageRef = useRef(page);
  pageRef.current = page;

  // URL 密码验证
  useEffect(() => {
    if (!urlAuthPending || authed) return;

    const verifyUrlPassword = async () => {
      let sessionId = localStorage.getItem('gameSessionId');
      if (!sessionId) {
        sessionId = generateSessionId();
      }

      try {
        const response = await fetch('/api/verify-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: urlAuthPending, sessionId }),
        });

        if (response.ok) {
          localStorage.setItem('gameSessionId', sessionId);
          setAuthed(true);
        }
      } catch (err) {
        console.error('URL password verification failed:', err);
      }

      // 清除 URL 中的密码参数
      const params = new URLSearchParams(window.location.search);
      params.delete('pwd');
      params.delete('password');
      const clean = params.toString();
      const newUrl = window.location.pathname + (clean ? '?' + clean : '') + window.location.hash;
      window.history.replaceState({}, '', newUrl);
      setUrlAuthPending(null);
    };

    verifyUrlPassword();
  }, [urlAuthPending, authed]);

  // 自动清除错误
  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(''), 3000);
      return () => clearTimeout(t);
    }
  }, [error]);

  // Socket 连接 - 只在认证后连接
  useEffect(() => {
    if (!authed) return;

    socket.connect();

    socket.on('connect', () => {
      console.log('Socket connected:', socket.id);
      setConnected(true);

      // 每次连接/重连都重新 join room，确保 Socket.IO room 成员关系恢复
      const savedRoom = localStorage.getItem('wuc_room_id');
      const savedName = localStorage.getItem('wuc_player_name');
      if (savedRoom && savedName) {
        socket.emit('join-room', {
          roomId: savedRoom,
          playerName: savedName,
          playerId,
        }, (res) => {
          if (res && !res.error) {
            setRoomId(savedRoom);
            setPlayerName(savedName);
            // 只有首次进入时才切页面，重连时保持当前页面
            if (pageRef.current === 'home') {
              if (res.word) {
                setMyWord(res.word);
                setPage('game');
              } else {
                setPage('room');
              }
            }
            // 重连时恢复词语
            if (res.word) {
              setMyWord(res.word);
            }
          } else {
            // 房间已不存在，清理
            if (pageRef.current === 'home') {
              localStorage.removeItem('wuc_room_id');
            }
          }
        });
      }
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected');
      setConnected(false);
    });

    socket.on('connect_error', (err) => {
      console.error('Socket connect error:', err.message);
      setConnected(false);
    });

    socket.on('room-update', (state) => {
      setRoomState(state);
      // 所有玩家都在线时清除掉线通知
      if (state.players.every(p => p.online !== false)) {
        setDisconnectNotice(null);
      }
      if (state.phase === 'waiting') {
        if (pageRef.current === 'game') setPage('room');
      } else if (state.phase !== 'waiting' && pageRef.current === 'room') {
        setPage('game');
      }
    });

    socket.on('your-word', ({ word, role }) => {
      setMyWord(word);
      setMyRole(role);
    });

    socket.on('words-changed', () => {
      // 词语已换，your-word 事件会紧跟着送来新词
    });

    socket.on('vote-result', (result) => {
      setVoteResult(result);
    });

    socket.on('game-reset', () => {
      setMyWord(null);
      setMyRole(null);
      setVoteResult(null);
      setDisconnectNotice(null);
      setPage('room');
    });

    socket.on('player-disconnect-countdown', ({ playerName, seconds }) => {
      setDisconnectNotice({ playerName, seconds });
    });

    socket.on('game-aborted', ({ reason }) => {
      setDisconnectNotice(null);
      setError(reason);
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('connect_error');
      socket.off('room-update');
      socket.off('your-word');
      socket.off('vote-result');
      socket.off('game-reset');
      socket.off('words-changed');
      socket.off('player-disconnect-countdown');
      socket.off('game-aborted');
      socket.disconnect();
    };
  }, [authed, playerId]);

  const createRoom = useCallback((name) => {
    if (!socket.connected) {
      setError('正在连接服务器，请稍后再试...');
      return;
    }
    setPlayerName(name);
    localStorage.setItem('wuc_player_name', name);
    socket.emit('create-room', { playerName: name, playerId }, (res) => {
      if (!res) {
        setError('服务器无响应，请检查网络');
        return;
      }
      if (res.error) {
        setError(res.error);
        return;
      }
      setRoomId(res.roomId);
      localStorage.setItem('wuc_room_id', res.roomId);
      setPage('room');
    });
  }, [playerId]);

  const joinRoom = useCallback((name, rid) => {
    if (!socket.connected) {
      setError('正在连接服务器，请稍后再试...');
      return;
    }
    setPlayerName(name);
    localStorage.setItem('wuc_player_name', name);
    socket.emit('join-room', { roomId: rid, playerName: name, playerId }, (res) => {
      if (!res) {
        setError('服务器无响应，请检查网络');
        return;
      }
      if (res.error) {
        setError(res.error);
        return;
      }
      setRoomId(res.roomId);
      localStorage.setItem('wuc_room_id', res.roomId);
      if (res.word) {
        setMyWord(res.word);
        setPage('game');
      } else {
        setPage('room');
      }
    });
  }, [playerId]);

  const leaveRoom = useCallback(() => {
    localStorage.removeItem('wuc_room_id');
    setRoomId(null);
    setRoomState(null);
    setMyWord(null);
    setMyRole(null);
    setVoteResult(null);
    setPage('home');
    socket.disconnect();
    socket.connect();
  }, []);

  const handleGatePass = useCallback(() => {
    setAuthed(true);
  }, []);

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <GatePassword onPass={handleGatePass} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {error && (
          <div
            className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-500 text-white px-6 py-3 rounded-2xl shadow-lg animate-fade-in max-w-sm text-center"
            onClick={() => setError('')}
          >
            {error}
          </div>
        )}

        {page === 'home' && (
          <Home
            playerName={playerName}
            connected={connected}
            onCreateRoom={createRoom}
            onJoinRoom={joinRoom}
          />
        )}

        {page === 'room' && roomState && (
          <Room
            roomState={roomState}
            playerId={playerId}
            onLeave={leaveRoom}
          />
        )}

        {page === 'game' && roomState && (
          <Game
            roomState={roomState}
            playerId={playerId}
            myWord={myWord}
            myRole={myRole}
            voteResult={voteResult}
            setVoteResult={setVoteResult}
            disconnectNotice={disconnectNotice}
          />
        )}
      </div>
    </div>
  );
}
