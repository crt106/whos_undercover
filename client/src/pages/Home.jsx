import { useState } from 'react';

export default function Home({ playerName: initialName, connected, onCreateRoom, onJoinRoom }) {
  const [name, setName] = useState(initialName || '');
  const [roomCode, setRoomCode] = useState('');
  const [mode, setMode] = useState(null); // null, 'join'

  const handleCreate = () => {
    if (!name.trim()) return;
    onCreateRoom(name.trim());
  };

  const handleJoin = () => {
    if (!name.trim() || !roomCode.trim()) return;
    onJoinRoom(name.trim(), roomCode.trim());
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

      {/* 昵称输入 */}
      <div>
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
      {mode !== 'join' ? (
        <div className="space-y-3">
          <button className="btn-primary" onClick={handleCreate} disabled={!name.trim() || !connected}>
            创建房间
          </button>
          <button className="btn-secondary" onClick={() => setMode('join')} disabled={!name.trim()}>
            加入房间
          </button>
        </div>
      ) : (
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
      )}

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
