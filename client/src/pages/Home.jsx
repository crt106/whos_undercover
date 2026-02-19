import { useState, useEffect, useRef } from 'react';

const AVATAR_OPTIONS = ['🐱', '🐶', '🐰', '🦊', '🐻', '🐼', '🐨', '🦁', '🐸', '🐵', '🐔', '🐧', '🦄', '🐯', '🐮', '🐷', '🐙', '🦋', '🐢'];

export default function Home({ playerName: initialName, playerAvatar: initialAvatar, connected, onCreateRoom, onJoinRoom }) {
  const [name, setName] = useState(initialName || '');
  const [avatar, setAvatar] = useState(initialAvatar || AVATAR_OPTIONS[0]);
  const [roomCode, setRoomCode] = useState('');
  const [mode, setMode] = useState(null); // null, 'join', 'rooms', 'mic-test'
  const [rooms, setRooms] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);

  // 麦克风测试状态
  const [micStatus, setMicStatus] = useState('idle'); // 'idle' | 'testing' | 'recording' | 'playing' | 'success' | 'error'
  const [micError, setMicError] = useState('');
  const streamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunks = useRef([]);
  const audioRef = useRef(null);

  // 从 localStorage 获取已验证的 sessionId
  const [sessionId] = useState(() => localStorage.getItem('gameSessionId') || '');

  const roomsPerPage = 5;

  // 获取房间列表
  const fetchRooms = async () => {
    if (!connected) return;
    setLoading(true);
    try {
      const response = await fetch('/api/rooms', {
        headers: {
          'X-Session-Id': sessionId
        }
      });
      if (response.ok) {
        const roomList = await response.json();
        setRooms(roomList);
      }
    } catch (error) {
      console.error('获取房间列表失败:', error);
    } finally {
      setLoading(false);
    }
  };

  // 进入房间列表模式时获取数据
  useEffect(() => {
    if (mode === 'rooms') {
      fetchRooms();
      // 每5秒刷新一次房间列表
      const interval = setInterval(fetchRooms, 5000);
      return () => clearInterval(interval);
    }
  }, [mode, connected]);

  // 过滤和分页逻辑
  const filteredRooms = rooms.filter(room =>
    room.hostName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    room.id.includes(searchTerm)
  );

  const totalPages = Math.ceil(filteredRooms.length / roomsPerPage);
  const startIndex = (currentPage - 1) * roomsPerPage;
  const currentRooms = filteredRooms.slice(startIndex, startIndex + roomsPerPage);

  // 重置分页当搜索条件改变时
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  const handleCreate = () => {
    if (!name.trim()) return;
    onCreateRoom(name.trim(), avatar);
  };

  const handleJoin = () => {
    if (!name.trim() || !roomCode.trim()) return;
    onJoinRoom(name.trim(), roomCode.trim(), avatar);
  };

  const handleJoinRoom = (roomId) => {
    if (!name.trim()) return;
    onJoinRoom(name.trim(), roomId, avatar);
  };

  // 麦克风测试相关函数
  const cleanupMicTest = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    mediaRecorderRef.current = null;
    audioChunks.current = [];
  };

  const startMicTest = async () => {
    setMicError('');
    setMicStatus('testing');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMicError('您的浏览器不支持录音功能');
      setMicStatus('error');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: true },
        }
      });
      streamRef.current = stream;
      setMicStatus('recording');

      // 选择 mimeType
      let mimeType = '';
      if (typeof MediaRecorder.isTypeSupported === 'function') {
        for (const type of ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav']) {
          if (MediaRecorder.isTypeSupported(type)) {
            mimeType = type;
            break;
          }
        }
      }

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      audioChunks.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(audioChunks.current, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size < 500) {
          setMicError('录音太短，请重试');
          setMicStatus('idle');
          return;
        }

        // 播放录音
        setMicStatus('playing');
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;

        audio.onended = () => {
          URL.revokeObjectURL(url);
          setMicStatus('success');
        };

        audio.onerror = () => {
          URL.revokeObjectURL(url);
          setMicError('播放失败');
          setMicStatus('error');
        };

        audio.play();
      };

      mediaRecorderRef.current = recorder;
      recorder.start();

      // 3秒后自动停止
      setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
          if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
          }
        }
      }, 3000);

    } catch (err) {
      console.error('Mic test error:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setMicError('麦克风权限被拒绝，请点击地址栏左侧的锁图标开启权限');
      } else if (err.name === 'NotFoundError') {
        setMicError('未检测到麦克风设备');
      } else if (err.name === 'NotReadableError') {
        setMicError('麦克风被其他应用占用');
      } else {
        setMicError('无法访问麦克风: ' + (err.message || err.name));
      }
      setMicStatus('error');
    }
  };

  const exitMicTest = () => {
    cleanupMicTest();
    setMicStatus('idle');
    setMicError('');
    setMode(null);
  };

  return (
    <div className="card animate-fade-in space-y-6">
      {/* Logo */}
      <div className="text-center space-y-2">
        <div className="text-6xl">🕵️</div>
        <h1 className="text-3xl font-black bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">
          谁是卧底
        </h1>
        <p className="text-violet-400 text-sm">在线多人语音推理游戏</p>
      </div>

      {/* 连接状态 */}
      {!connected && (
        <div className="text-center text-sm text-orange-500 bg-orange-50 rounded-xl py-2 px-4">
          正在连接服务器...
        </div>
      )}

      {/* 昵称 & 头像 */}
      <div className="space-y-3">
        {/* 头像选择 */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-12 h-12 rounded-full bg-violet-100 flex items-center justify-center text-2xl shrink-0 ring-2 ring-violet-400">
              {avatar}
            </div>
            <div
              className="avatar-scroll flex gap-2 flex-1 overflow-x-auto py-1"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' }}
            >
              <style>{`.avatar-scroll::-webkit-scrollbar { display: none; }`}</style>
              {AVATAR_OPTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setAvatar(emoji)}
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-xl transition-all shrink-0 ${avatar === emoji
                    ? 'bg-violet-200 ring-2 ring-violet-500 scale-110'
                    : 'bg-gray-100 hover:bg-violet-50 hover:scale-105'
                    }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
        {/* 昵称输入 */}
        <input
          type="text"
          className="input-field"
          placeholder="输入你的昵称"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={8}
        />
      </div>

      {/* 按钮 */}
      {mode === null ? (
        <div className="space-y-3">
          <button className="btn-primary" onClick={handleCreate} disabled={!name.trim() || !connected}>
            创建房间
          </button>
          <button className="btn-secondary" onClick={() => setMode('rooms')} disabled={!name.trim()}>
            浏览房间
          </button>
          <button className="btn-secondary" onClick={() => setMode('join')} disabled={!name.trim()}>
            输入房间号
          </button>
          <button
            className="w-full py-3 rounded-2xl font-bold text-base bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all"
            onClick={() => setMode('mic-test')}
          >
            🎤 测试麦克风
          </button>
        </div>
      ) : mode === 'mic-test' ? (
        <div className="space-y-4 animate-fade-in">
          <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center space-y-4">
            <div className="text-4xl">
              {micStatus === 'idle' && '🎤'}
              {micStatus === 'testing' && '⏳'}
              {micStatus === 'recording' && '🔴'}
              {micStatus === 'playing' && '🔊'}
              {micStatus === 'success' && '✅'}
              {micStatus === 'error' && '❌'}
            </div>
            <div className="text-gray-700 font-medium">
              {micStatus === 'idle' && '点击下方按钮开始测试'}
              {micStatus === 'testing' && '正在请求麦克风权限...'}
              {micStatus === 'recording' && '正在录音... (3秒)'}
              {micStatus === 'playing' && '正在播放录音...'}
              {micStatus === 'success' && '麦克风工作正常！'}
              {micStatus === 'error' && '测试失败'}
            </div>
            {micError && (
              <div className="text-sm text-red-500 bg-red-50 rounded-xl p-3">
                {micError}
              </div>
            )}
            {micStatus === 'recording' && (
              <div className="flex justify-center">
                <div className="w-4 h-4 bg-red-500 rounded-full animate-pulse"></div>
              </div>
            )}
          </div>

          {(micStatus === 'idle' || micStatus === 'success' || micStatus === 'error') && (
            <button
              className="btn-primary"
              onClick={startMicTest}
            >
              {micStatus === 'idle' ? '开始测试' : '重新测试'}
            </button>
          )}

          <button className="btn-secondary" onClick={exitMicTest}>
            返回
          </button>
        </div>
      ) : mode === 'join' ? (
        <div className="space-y-3 animate-fade-in">
          <input
            type="text"
            className="input-field tracking-[0.5em]"
            placeholder="输入房间号"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            maxLength={6}
            inputMode="numeric"
          />
          <button className="btn-primary" onClick={handleJoin} disabled={!name.trim() || roomCode.length !== 6 || !connected}>
            加入
          </button>
          <button className="btn-secondary" onClick={() => setMode(null)}>
            返回
          </button>
        </div>
      ) : mode === 'rooms' ? (
        <div className="space-y-4 animate-fade-in">
          {/* 搜索框 */}
          <input
            type="text"
            className="input-field"
            placeholder="搜索房主名称或房间号..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />

          {/* 房间列表 */}
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            {loading ? (
              <div className="p-6 text-center text-gray-500">
                <div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full mx-auto mb-2"></div>
                加载中...
              </div>
            ) : currentRooms.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                {filteredRooms.length === 0 && rooms.length === 0 ? '暂无可用房间' : '没有找到匹配的房间'}
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {currentRooms.map((room) => (
                  <div key={room.id} className="p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2">
                          <span className="font-medium text-gray-900">#{room.id}</span>
                          <span className="text-sm text-gray-500">房主: {room.hostName}</span>
                        </div>
                        <div className="text-sm text-gray-400 mt-1">
                          {room.playerCount}/{room.maxPlayers} 人
                        </div>
                      </div>
                      <button
                        className="px-4 py-2 bg-violet-500 text-white rounded-xl hover:bg-violet-600 transition-colors text-sm"
                        onClick={() => handleJoinRoom(room.id)}
                        disabled={!connected}
                      >
                        加入
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center space-x-2">
              <button
                className="px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
              >
                上一页
              </button>
              <span className="text-sm text-gray-500">
                {currentPage} / {totalPages}
              </span>
              <button
                className="px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
              >
                下一页
              </button>
            </div>
          )}

          <button className="btn-secondary w-full" onClick={() => setMode(null)}>
            返回
          </button>
        </div>
      ) : null}

      {/* 规则 */}
      <div className="bg-violet-50 rounded-2xl p-4 space-y-2">
        <h3 className="font-bold text-violet-700 text-sm">游戏规则</h3>
        <ul className="text-xs text-violet-500 space-y-1">
          <li>• 每人获得一个词语，卧底的词与其他人不同但相近</li>
          <li>• 轮流用语言描述自己的词，不能直接说出词语</li>
          <li>• 每轮投票选出最可疑的人，被投出者出局</li>
          <li>• 平民投出所有卧底则胜利，反之卧底胜利</li>
        </ul>
      </div>
    </div>
  );
}
