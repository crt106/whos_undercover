import { useState } from 'react';
import socket from '../socket';
import PlayerCard from '../components/PlayerCard';

export default function Room({ roomState, playerId, isSpectator, onLeave }) {
  const [copied, setCopied] = useState(false);
  const isHost = playerId === roomState.hostId;
  const me = roomState.players.find(p => p.id === playerId);
  // 房主不参与准备状态，只需其他玩家全部准备
  const nonHostPlayers = roomState.players.filter(p => p.id !== roomState.hostId);
  const allReady = roomState.players.length >= 4 && nonHostPlayers.every(p => p.ready);
  const maxUndercoverCount = Math.max(1, Math.floor((roomState.players.length - 1) / 2));

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

  const setUndercoverGuessMode = (mode) => {
    socket.emit('set-undercover-guess-mode', { mode });
  };

  const setBlankEnabled = (enabled) => {
    socket.emit('set-blank-enabled', { enabled });
  };

  const blankEnabled = !!roomState.blankEnabled;
  const blankMinPlayersUnmet = blankEnabled && roomState.players.length < 5;

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

      {/* 观战者标识 */}
      {isSpectator && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl px-4 py-2.5 text-center">
          <p className="text-sm font-bold text-blue-600">👁 观战模式 · 仅可观看，无法参与游戏</p>
        </div>
      )}

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

      {/* 观战者列表 */}
      {roomState.spectators?.length > 0 && (
        <div>
          <p className="text-sm text-violet-400 mb-2 text-center">观战者 ({roomState.spectators.length})</p>
          <div className="flex flex-wrap gap-2 justify-center">
            {roomState.spectators.map(s => (
              <div key={s.id} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-blue-50 border border-blue-100 ${s.online === false ? 'opacity-40' : ''}`}>
                <span>{s.avatar || '👤'}</span>
                <span className="text-blue-600">{s.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 房主设置 */}
      {isHost && (
        <div className="bg-violet-50 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-bold text-violet-700">卧底人数</p>
            <p className="text-xs text-violet-400">
              当前最多 {maxUndercoverCount} 人
            </p>
          </div>
          <div className="flex gap-2">
            {[1, 2, 3].map(n => {
              const disabled = n > maxUndercoverCount;
              const active = roomState.undercoverCount === n && !disabled;

              return (
                <button
                  key={n}
                  className={`flex-1 py-2 rounded-xl font-bold border transition-all ${
                    disabled
                      ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-300'
                      : active
                        ? 'border-violet-500 bg-violet-500 text-white shadow-md active:scale-95'
                        : 'border-violet-200 bg-white text-violet-500 active:scale-95'
                  }`}
                  onClick={() => setUndercoverCount(n)}
                  disabled={disabled}
                  title={disabled ? `当前 ${roomState.players.length} 人最多只能设置 ${maxUndercoverCount} 名卧底` : ''}
                >
                  {n}人
                </button>
              );
            })}
          </div>

          <div className="pt-3 border-t border-violet-100 space-y-2">
            <p className="text-sm font-bold text-violet-700">猜词触发</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'every_undercover', label: '每次淘汰', hint: '任一卧底/白板出局都猜' },
                { value: 'final_undercover', label: '最后非平民', hint: '最后非平民出局再猜' },
              ].map(option => {
                const active = (roomState.undercoverGuessMode || 'every_undercover') === option.value;
                return (
                  <button
                    key={option.value}
                    className={`py-2 px-2 rounded-xl border font-bold transition-all active:scale-95 ${
                      active
                        ? 'bg-violet-500 text-white border-violet-500 shadow-md'
                        : 'bg-white text-violet-500 border-violet-200'
                    }`}
                    onClick={() => setUndercoverGuessMode(option.value)}
                  >
                    <span className="block text-sm">{option.label}</span>
                    <span className={`block text-[10px] font-medium mt-0.5 ${active ? 'text-violet-100' : 'text-violet-300'}`}>
                      {option.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-3 border-t border-violet-100 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-violet-700">白板（无词卧底）</p>
              <button
                role="switch"
                aria-checked={blankEnabled}
                onClick={() => setBlankEnabled(!blankEnabled)}
                className={`relative w-11 h-6 rounded-full transition-colors active:scale-95 ${
                  blankEnabled ? 'bg-violet-500' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${
                    blankEnabled ? 'translate-x-5' : ''
                  }`}
                />
              </button>
            </div>
            <p className="text-[11px] text-violet-400 leading-relaxed">
              开启后随机指定 1 名玩家为白板（无词，独立阵营）。所有卧底出局且白板存活则白板独胜；卧底胜利需玩家剩 2 人（&lt;7 人局）或 3 人（≥7 人局）。需至少 5 人。
            </p>
            {blankMinPlayersUnmet && (
              <p className="text-[11px] text-orange-500">当前不足 5 人，开始游戏前请先满足人数。</p>
            )}
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="space-y-3">
        {!isSpectator && !isHost && (
          <button
            className={me?.ready ? 'btn-secondary' : 'btn-primary'}
            onClick={toggleReady}
          >
            {me?.ready ? '取消准备' : '准备'}
          </button>
        )}
        {!isSpectator && isHost && (
          <button
            className="btn-primary"
            onClick={startGame}
            disabled={!allReady}
          >
            {allReady ? '开始游戏' : `等待准备 (${nonHostPlayers.filter(p => p.ready).length}/${nonHostPlayers.length})`}
          </button>
        )}
        <button className="btn-secondary text-base" onClick={onLeave}>
          {isSpectator ? '退出观战' : '离开房间'}
        </button>
      </div>
    </div>
  );
}
