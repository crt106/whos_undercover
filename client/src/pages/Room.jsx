import { useState } from 'react';
import socket from '../socket';
import PlayerCard from '../components/PlayerCard';

export default function Room({ roomState, playerId, onLeave }) {
  const [copied, setCopied] = useState(false);
  const isHost = playerId === roomState.hostId;
  const me = roomState.players.find(p => p.id === playerId);
  // 房主不参与准备状态，只需其他玩家全部准备
  const nonHostPlayers = roomState.players.filter(p => p.id !== roomState.hostId);
  const allReady = roomState.players.length >= 4 && nonHostPlayers.every(p => p.ready);

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomState.id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const toggleReady = () => {
    socket.emit('player-ready', { ready: !me?.ready });
  };

  const startGame = () => {
    socket.emit('start-game');
  };

  const setUndercoverCount = (count) => {
    socket.emit('set-undercover-count', { count });
  };

  return (
    <div className="card animate-fade-in space-y-5">
      {/* 房间号 */}
      <div className="text-center">
        <p className="text-sm text-violet-400 mb-1">房间号</p>
        <div className="flex items-center justify-center gap-2">
          <span className="text-3xl font-black tracking-[0.3em] text-violet-700">
            {roomState.id}
          </span>
          <button
            className="text-xs bg-violet-100 text-violet-600 px-3 py-1.5 rounded-full active:scale-95 transition-all"
            onClick={copyRoomId}
          >
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      </div>

      {/* 玩家列表 */}
      <div>
        <p className="text-sm text-violet-400 mb-3 text-center">
          玩家 ({roomState.players.length}/12)
          {roomState.players.length < 4 && (
            <span className="text-orange-400 ml-2">至少需要4人</span>
          )}
        </p>
        <div className="grid grid-cols-4 gap-3">
          {roomState.players.map((player) => (
            <PlayerCard
              key={player.id}
              player={player}
              isHost={player.id === roomState.hostId}
              isMe={player.id === playerId}
              showReady={player.id !== roomState.hostId}
            />
          ))}
          {/* 空位 */}
          {Array.from({ length: Math.max(0, 4 - roomState.players.length) }).map((_, i) => (
            <div key={`empty-${i}`} className="flex flex-col items-center gap-1">
              <div className="w-14 h-14 rounded-full border-2 border-dashed border-violet-200 flex items-center justify-center">
                <span className="text-violet-200 text-xl">?</span>
              </div>
              <span className="text-xs text-violet-200">等待中</span>
            </div>
          ))}
        </div>
      </div>

      {/* 房主设置 */}
      {isHost && (
        <div className="bg-violet-50 rounded-2xl p-4 space-y-3">
          <p className="text-sm font-bold text-violet-700">卧底人数</p>
          <div className="flex gap-2">
            {[1, 2, 3].map(n => (
              <button
                key={n}
                className={`flex-1 py-2 rounded-xl font-bold transition-all ${
                  roomState.undercoverCount === n
                    ? 'bg-violet-500 text-white shadow-md'
                    : 'bg-white text-violet-500 border border-violet-200'
                }`}
                onClick={() => setUndercoverCount(n)}
              >
                {n}人
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="space-y-3">
        {!isHost && (
          <button
            className={me?.ready ? 'btn-secondary' : 'btn-primary'}
            onClick={toggleReady}
          >
            {me?.ready ? '取消准备' : '准备'}
          </button>
        )}
        {isHost && (
          <button
            className="btn-primary"
            onClick={startGame}
            disabled={!allReady}
          >
            {allReady ? '开始游戏' : `等待准备 (${nonHostPlayers.filter(p => p.ready).length}/${nonHostPlayers.length})`}
          </button>
        )}
        <button className="btn-secondary text-base" onClick={onLeave}>
          离开房间
        </button>
      </div>
    </div>
  );
}
