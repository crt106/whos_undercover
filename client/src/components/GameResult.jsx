export default function GameResult({ voteResult, roomState, isHost, onNextRound, onPlayAgain, onClose }) {
  const isGameOver = roomState.phase === 'game_over';
  const isUndercoverGuess = roomState.phase === 'undercover_guess';
  const isFinalGuessMode = roomState.undercoverGuessMode === 'final_undercover';
  const isTieBattle = voteResult.tieBattle || voteResult.voteResult?.tieBattle;
  const tiedPlayerNames = voteResult.voteResult?.tiedPlayers?.map(p => p.name).join('、') || '';
  const isGuessingUndercover = Boolean(roomState.guessingUndercoverId)
    && voteResult.voteResult?.eliminated?.id === roomState.guessingUndercoverId;
  const isBlankMode = !!roomState.blankEnabled;
  const eliminatedRole = voteResult.voteResult?.eliminated?.role;
  const eliminatedRoleLabel = eliminatedRole === 'undercover'
    ? '卧底'
    : eliminatedRole === 'blank'
      ? '白板'
      : '平民';
  const guesserPlayer = roomState.guessResult
    ? roomState.players.find(p => p.id === roomState.guessResult.playerId)
    : null;
  const guesserLabel = guesserPlayer?.role === 'blank' ? '白板' : '卧底';
  const winnerEmoji = (winner) => winner === 'civilian' ? '🎉' : winner === 'blank' ? '🏳️' : '🕵️';
  const winnerLabel = (winner) => winner === 'civilian'
    ? '平民胜利！'
    : winner === 'blank'
      ? '白板独胜！'
      : '卧底胜利！';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="card !p-6 w-full max-w-sm animate-bounce-in space-y-4" onClick={e => e.stopPropagation()}>
        {/* 投票结果 */}
        {voteResult.voteResult && (
          <div className="text-center space-y-2">
            {voteResult.voteResult.tie ? (
              <>
                <div className="text-4xl">🤔</div>
                <p className="text-lg font-bold text-violet-700">平票！进入平票battle</p>
                {tiedPlayerNames && (
                  <p className="text-sm text-amber-600">
                    候选人：<span className="font-bold">{tiedPlayerNames}</span>
                  </p>
                )}
              </>
            ) : voteResult.voteResult.eliminated ? (
              <>
                <div className="text-4xl">😵</div>
                <p className="text-lg font-bold text-violet-700">
                  {voteResult.voteResult.eliminated.name} 被淘汰了
                </p>
                <p className={`font-bold ${
                  eliminatedRole === 'undercover'
                    ? 'text-red-500'
                    : eliminatedRole === 'blank'
                      ? 'text-gray-500'
                      : 'text-blue-500'
                }`}>
                  TA是{eliminatedRoleLabel}！
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
            <div className="text-5xl">{winnerEmoji(voteResult.gameOver.winner)}</div>
            <p className="text-2xl font-black text-violet-700">
              {winnerLabel(voteResult.gameOver.winner)}
            </p>
            <div className="text-sm text-violet-500 space-y-1">
              <p>平民词：<span className="font-bold">{voteResult.gameOver.civilianWord}</span></p>
              <p>卧底词：<span className="font-bold text-red-500">{voteResult.gameOver.undercoverWord}</span></p>
            </div>
          </div>
        )}

        {/* 卧底/白板进入猜词阶段提示 */}
        {(isUndercoverGuess || (voteResult.gameOver?.guessRequired && !roomState.guessResult)) && (() => {
          const triggerRole = eliminatedRole === 'blank' ? '白板' : '卧底';
          return (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center space-y-1">
              <p className="text-sm font-bold text-red-700">
                🕵️ {isFinalGuessMode ? `${triggerRole}的最后机会！` : `${triggerRole}的猜词机会！`}
              </p>
              <p className="text-xs text-red-500">{triggerRole}被淘汰，还有 30 秒猜出平民词语获胜！</p>
            </div>
          );
        })()}

        {isGameOver && roomState.guessResult && (
          <div className="text-center space-y-2 pt-2 border-t border-violet-100">
            <div className="text-5xl">{winnerEmoji(roomState.winner)}</div>
            <p className="text-2xl font-black text-violet-700">
              {winnerLabel(roomState.winner)}
            </p>
            <div className="bg-violet-50 rounded-xl p-3 text-sm space-y-1">
              {roomState.guessResult.timeout ? (
                <p className="text-violet-500">{guesserLabel}未在限时内猜出词语</p>
              ) : roomState.guessResult.correct ? (
                <p className="text-green-600 font-bold">{guesserLabel}猜对了「{roomState.civilianWord}」</p>
              ) : (
                <p className="text-red-500">{guesserLabel}猜了「{roomState.guessResult.guess}」，猜错了</p>
              )}
            </div>
            <div className="text-sm text-violet-500 space-y-1">
              <p>平民词：<span className="font-bold">{roomState.civilianWord}</span></p>
              <p>卧底词：<span className="font-bold text-red-500">{roomState.undercoverWord}</span></p>
            </div>
          </div>
        )}

        {/* 非最后卧底/白板猜错后，游戏继续 */}
        {!isGameOver && !isUndercoverGuess && roomState.guessResult && !roomState.guessResult.correct && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center space-y-1">
            <p className="text-sm font-bold text-amber-700">
              {roomState.guessResult.timeout ? `${guesserLabel}猜词超时` : `${guesserLabel}猜词失败`}
            </p>
            <p className="text-xs text-amber-600">仍有非平民存活，游戏继续。</p>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="space-y-2">
          {isGameOver && isHost && (
            <button className="btn-primary" onClick={onPlayAgain}>
              再来一局
            </button>
          )}
          {!isTieBattle && !isGameOver && !isUndercoverGuess && isHost && (
            <button className="btn-primary" onClick={onNextRound}>
              下一轮
            </button>
          )}
          {isTieBattle ? (
            <p className="text-center text-xs text-amber-600">关闭后继续平票battle发言</p>
          ) : !isGameOver && !isUndercoverGuess && (
            <p className="text-center text-xs text-violet-400">15 秒后自动进入下一轮</p>
          )}
          <button className="btn-secondary !py-2.5 !text-base" onClick={onClose}>
            {isUndercoverGuess && !isGuessingUndercover ? '关闭并观战' : '关闭'}
          </button>
        </div>
      </div>
    </div>
  );
}
