const AVATARS = ['🐱', '🐶', '🐰', '🦊', '🐻', '🐼', '🐨', '🦁', '🐸', '🐵', '🐔', '🐧'];

function getAvatar(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return AVATARS[Math.abs(hash) % AVATARS.length];
}

export default function PlayerCard({
  player,
  isHost,
  isMe,
  isSpeaking,
  isVotable,
  isVoted,
  onVote,
  showReady,
  showRole,
}) {
  const alive = player.alive !== false;
  const online = player.online !== false;
  const avatar = player.avatar || getAvatar(player.id);
  const showEliminatedRoleBadge = !alive && player.role;

  return (
    <div
      className={`flex flex-col items-center gap-1 transition-all ${
        isVotable ? 'cursor-pointer active:scale-90' : ''
      } ${!alive ? 'opacity-40' : ''} ${!online && alive ? 'opacity-60' : ''}`}
      onClick={() => isVotable && onVote?.()}
    >
      <div className="relative">
        {/* 发言指示器 */}
        {isSpeaking && (
          <div className="absolute -inset-1 rounded-full bg-violet-400 pulse-ring" />
        )}
        {/* 投票标记 */}
        {isVoted && (
          <div className="absolute -inset-1 rounded-full border-3 border-red-400 animate-bounce-in" />
        )}
        <div
          className={`w-14 h-14 rounded-full flex items-center justify-center text-2xl relative ${
            !online && alive
              ? 'bg-gray-100 ring-2 ring-gray-300'
              : isSpeaking
              ? 'bg-violet-100 ring-2 ring-violet-500'
              : isVoted
              ? 'bg-red-50 ring-2 ring-red-400'
              : 'bg-violet-50'
          } ${!alive ? 'grayscale' : ''}`}
        >
          {avatar}
          {!alive && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-3xl">✕</span>
            </div>
          )}
          {!online && alive && (
            <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full border-2 border-white flex items-center justify-center">
              <span className="text-white text-[8px] font-bold">!</span>
            </div>
          )}
        </div>
        {/* 房主标记 */}
        {isHost && !showEliminatedRoleBadge && (
          <span className="absolute -top-1 -right-1 text-xs">👑</span>
        )}
        {showEliminatedRoleBadge && (
          <span
            className={`absolute -top-1.5 -right-2 min-w-6 h-5 px-1 rounded-full border-2 border-white shadow-md flex items-center justify-center text-[10px] leading-none font-black ${
              player.role === 'undercover'
                ? 'bg-red-500 text-white'
                : 'bg-blue-500 text-white'
            }`}
            title={player.role === 'undercover' ? '卧底' : '平民'}
          >
            {player.role === 'undercover' ? '卧' : '平'}
          </span>
        )}
      </div>
      <span className={`text-xs font-medium truncate max-w-[60px] ${
        isMe ? 'text-violet-600 font-bold' : 'text-gray-600'
      }`}>
        {player.name}{isMe ? '(我)' : ''}
      </span>
      {/* 离线状态 */}
      {!online && (
        <span className="text-xs text-red-500 font-bold">离线</span>
      )}
      {/* 准备状态 */}
      {showReady && online && (
        <span className={`text-xs ${player.ready ? 'text-green-500' : 'text-gray-300'}`}>
          {player.ready ? '✓ 已准备' : '未准备'}
        </span>
      )}
      {/* 角色显示 */}
      {showRole && player.role && (
        <span className={`text-xs font-bold ${
          player.role === 'undercover' ? 'text-red-500' : 'text-blue-500'
        }`}>
          {player.role === 'undercover' ? '卧底' : '平民'}
        </span>
      )}
      {/* 已投票标记 */}
      {player.hasVoted && (
        <span className="text-xs text-green-500">已投票</span>
      )}
    </div>
  );
}
