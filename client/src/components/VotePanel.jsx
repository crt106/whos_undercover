export default function VotePanel({ players, playerId, myVote, onVote }) {
  const votable = players.filter(p => p.alive && p.id !== playerId);

  if (myVote) {
    const target = players.find(p => p.id === myVote);
    return (
      <div className="card !p-4 text-center animate-fade-in">
        <p className="text-violet-500">
          你投给了 <span className="font-bold text-violet-700">{target?.name}</span>
        </p>
        <p className="text-xs text-violet-300 mt-1">等待其他人投票...</p>
      </div>
    );
  }

  return (
    <div className="card !p-4 space-y-3 animate-bounce-in">
      <p className="text-sm font-bold text-violet-700 text-center">选择你认为的卧底</p>
      <div className="grid grid-cols-2 gap-2">
        {votable.map(player => (
          <button
            key={player.id}
            className="py-3 px-4 rounded-2xl bg-violet-50 text-violet-700 font-bold text-sm
                       border-2 border-violet-100 active:scale-95 active:border-violet-400 transition-all"
            onClick={() => onVote(player.id)}
          >
            {player.name}
          </button>
        ))}
      </div>
    </div>
  );
}
