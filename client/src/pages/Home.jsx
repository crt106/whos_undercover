import { useState, useEffect } from 'react';

export default function Home({ playerName: initialName, connected, onCreateRoom, onJoinRoom }) {
  const [name, setName] = useState(initialName || '');
  const [roomCode, setRoomCode] = useState('');
  const [mode, setMode] = useState(null); // null, 'join', 'rooms'
  const [rooms, setRooms] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);

  const roomsPerPage = 5;

  // 获取房间列表
  const fetchRooms = async () => {
    if (!connected) return;
    setLoading(true);
    try {
      const response = await fetch('/api/rooms');
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
    onCreateRoom(name.trim());
  };

  const handleJoin = () => {
    if (!name.trim() || !roomCode.trim()) return;
    onJoinRoom(name.trim(), roomCode.trim());
  };

  const handleJoinRoom = (roomId) => {
    if (!name.trim()) return;
    onJoinRoom(name.trim(), roomId);
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
