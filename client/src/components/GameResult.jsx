export default function GameResult({ voteResult, roomState, isHost, onNextRound, onPlayAgain, onClose }) {
  const isGameOver = roomState.phase === 'game_over';
  const isUndercoverGuess = roomState.phase === 'undercover_guess';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="card !p-6 w-full max-w-sm animate-bounce-in space-y-4" onClick={e => e.stopPropagation()}>
        {/* 投票结果 */}
        {voteResult.voteResult && (
          <div className="text-center space-y-2">
            {voteResult.voteResult.tie ? (
              <>
                <div className="text-4xl">🤔</div>
                <p className="text-lg font-bold text-violet-700">平票！无人淘汰</p>
              </>
            ) : voteResult.voteResult.eliminated ? (
              <>
                <div className="text-4xl">😵</div>
                <p className="text-lg font-bold text-violet-700">
                  {voteResult.voteResult.eliminated.name} 被淘汰了
                </p>
                <p className={`font-bold ${
                  voteResult.voteResult.eliminated.role === 'undercover'
                    ? 'text-red-500' : 'text-blue-500'
                }`}>
                  TA是{voteResult.voteResult.eliminated.role === 'undercover' ? '卧底' : '平民'}！
                </p>
              </>
            ) : null}

            {/* 投票详情 */}
            {voteResult.voteResult.voteCount && (
              <div className="bg-violet-50 rounded-xl p-3 mt-2">
                <p className="text-xs text-violet-400 mb-2">投票详情</p>
                {Object.entries(voteResult.voteResult.voteCount).map(([id, count]) => {
                  const player = roomState.players.find(p => p.id === id);
                  return (
                    <div key={id} className="flex justify-between text-sm">
                      <span className="text-violet-600">{player?.name || '未知'}</span>
                      <span className="font-bold text-violet-700">{count} 票</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 游戏结束 */}
        {isGameOver && voteResult.gameOver && !voteResult.gameOver.guessRequired && (
          <div className="text-center space-y-2 pt-2 border-t border-violet-100">
            <div className="text-5xl">
              {voteResult.gameOver.winner === 'civilian' ? '🎉' : '🕵️'}
            </div>
            <p className="text-2xl font-black text-violet-700">
              {voteResult.gameOver.winner === 'civilian' ? '平民胜利！' : '卧底胜利！'}
            </p>
            <div className="text-sm text-violet-500 space-y-1">
              <p>平民词：<span className="font-bold">{voteResult.gameOver.civilianWord}</span></p>
              <p>卧底词：<span className="font-bold text-red-500">{voteResult.gameOver.undercoverWord}</span></p>
            </div>
          </div>
        )}

        {/* 卧底进入猜词阶段提示 */}
        {(isUndercoverGuess || voteResult.gameOver?.guessRequired) && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center space-y-1">
            <p className="text-sm font-bold text-red-700">🕵️ 卧底的最后机会！</p>
            <p className="text-xs text-red-500">卧底被淘汰，但还有 30 秒猜出平民词语翻盘！</p>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="space-y-2">
          {isGameOver && isHost && (
            <button className="btn-primary" onClick={onPlayAgain}>
              再来一局
            </button>
          )}
          {!isGameOver && !isUndercoverGuess && isHost && (
            <button className="btn-primary" onClick={onNextRound}>
              下一轮
            </button>
          )}
          <button className="btn-secondary !py-2.5 !text-base" onClick={onClose}>
            {isUndercoverGuess ? '关闭并观战' : '关闭'}
          </button>
        </div>
      </div>
    </div>
  );
}
