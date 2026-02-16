import { useState, useEffect, useRef } from 'react';
import socket from '../socket';
import PlayerCard from '../components/PlayerCard';
import VoiceRecorder from '../components/VoiceRecorder';
import VotePanel from '../components/VotePanel';
import GameResult from '../components/GameResult';
import Timer from '../components/Timer';

export default function Game({ roomState, playerId, myWord, myRole, voteResult, setVoteResult, disconnectNotice }) {
  const [showWord, setShowWord] = useState(false);
  const [speechText, setSpeechText] = useState('');
  const [myVote, setMyVote] = useState(null);
  const [showResult, setShowResult] = useState(false);

  const isHost = playerId === roomState.hostId;
  const me = roomState.players.find(p => p.id === playerId);
  const currentSpeaker = roomState.players[roomState.currentSpeakerIndex];
  const isMyTurn = currentSpeaker?.id === playerId;

  // 当收到投票结果时显示
  useEffect(() => {
    if (voteResult) {
      setShowResult(true);
      setMyVote(null);
    }
  }, [voteResult]);

  // 阶段变化时重置
  useEffect(() => {
    if (roomState.phase === 'speaking') {
      setSpeechText('');
      setMyVote(null);
    }
  }, [roomState.phase, roomState.round]);

  const submitSpeech = (speech) => {
    socket.emit('submit-speech', { speech }, (res) => {
      if (res?.error) console.error(res.error);
    });
    setSpeechText('');
  };

  const submitTextSpeech = () => {
    if (!speechText.trim()) return;
    submitSpeech({ type: 'text', content: speechText.trim() });
  };

  const submitVoiceSpeech = (url) => {
    submitSpeech({ type: 'voice', content: url });
  };

  const submitVote = (targetId) => {
    setMyVote(targetId);
    socket.emit('submit-vote', { targetId });
  };

  const nextRound = () => {
    setShowResult(false);
    setVoteResult(null);
    socket.emit('next-round');
  };

  const playAgain = () => {
    setShowResult(false);
    setVoteResult(null);
    socket.emit('play-again');
  };

  // 换词仅在准备阶段
  const canChangeWord = !roomState.wordChanged && roomState.phase === 'playing';
  const hasVotedChange = roomState.changeWordVoters?.includes(playerId);

  const voteChangeWord = () => {
    socket.emit('vote-change-word');
  };

  const phaseLabel = {
    playing: '准备阶段',
    speaking: `第 ${roomState.round} 轮 · 发言中`,
    voting: `第 ${roomState.round} 轮 · 投票中`,
    result: `第 ${roomState.round} 轮 · 投票结果`,
    game_over: '游戏结束',
  };

  // 检查是否有离线玩家（活着的）
  const offlinePlayers = roomState.players.filter(p => p.alive && p.online === false);

  return (
    <div className="space-y-4 animate-fade-in">
      {/* 掉线等待横幅 */}
      {disconnectNotice && (
        <DisconnectBanner
          playerName={disconnectNotice.playerName}
          totalSeconds={disconnectNotice.seconds}
        />
      )}

      {/* 离线玩家提示（无倒计时时的静态提示） */}
      {!disconnectNotice && offlinePlayers.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-2xl p-3 text-center">
          <p className="text-sm text-orange-600">
            <span className="font-bold">{offlinePlayers.map(p => p.name).join('、')}</span> 连接已断开，等待重连...
          </p>
        </div>
      )}

      {/* 顶部信息 */}
      <div className={`rounded-2xl p-4 shadow-md transition-colors duration-300 ${
        roomState.phase === 'playing'
          ? 'bg-amber-50 border border-amber-200'
          : roomState.phase === 'speaking'
          ? 'bg-blue-50 border border-blue-200'
          : roomState.phase === 'voting'
          ? 'bg-rose-50 border border-rose-200'
          : 'card !p-4'
      }`}>
        <div className="flex items-center justify-between">
          <span className={`text-sm font-bold ${
            roomState.phase === 'playing'
              ? 'text-amber-700'
              : roomState.phase === 'speaking'
              ? 'text-blue-700'
              : roomState.phase === 'voting'
              ? 'text-rose-700'
              : 'text-violet-700'
          }`}>
            {roomState.phase === 'playing' ? '⏳ ' : roomState.phase === 'speaking' ? '💬 ' : roomState.phase === 'voting' ? '🗳️ ' : ''}
            {phaseLabel[roomState.phase] || ''}
          </span>
          {roomState.phase === 'playing' && (
            <Timer key={`playing-${roomState.wordChanged}`} seconds={30} />
          )}
          {roomState.phase === 'speaking' && (
            <Timer key={`speak-${roomState.currentSpeakerIndex}-${roomState.round}`} seconds={60} />
          )}
          {roomState.phase === 'voting' && !myVote && (
            <Timer key={`vote-${roomState.round}`} seconds={30} />
          )}
        </div>
      </div>

      {/* 我的词语 */}
      {myWord && me?.alive && (
        <div className="card !p-4 text-center">
          <p className="text-xs text-violet-400 mb-1">我的词语（点击查看）</p>
          <div
            className="cursor-pointer select-none"
            onClick={() => setShowWord(!showWord)}
          >
            {showWord ? (
              <span className="text-2xl font-black text-violet-700 animate-fade-in">
                {myWord}
              </span>
            ) : (
              <span className="text-2xl font-black text-violet-200">
                ● ● ●
              </span>
            )}
          </div>
          {/* 换词按钮和投票进度 */}
          {canChangeWord && (
            <div className="mt-3 space-y-2">
              <button
                className={`px-5 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 ${
                  hasVotedChange
                    ? 'bg-orange-100 text-orange-500 border border-orange-300'
                    : 'bg-orange-500 text-white shadow-md'
                }`}
                onClick={voteChangeWord}
                disabled={hasVotedChange}
              >
                {hasVotedChange ? '已投换词' : '投票换词'}
              </button>
              {roomState.changeWordVotes > 0 && (
                <p className="text-xs text-orange-500">
                  {roomState.changeWordVotes}/{roomState.changeWordNeeded} 人同意
                  <span className="text-orange-400 ml-1">
                    ({roomState.players
                      .filter(p => roomState.changeWordVoters?.includes(p.id))
                      .map(p => p.id === playerId ? '我' : p.name)
                      .join('、')})
                  </span>
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* 玩家列表 */}
      <div className="card !p-4">
        <div className="grid grid-cols-4 gap-3">
          {roomState.players.map((player, idx) => (
            <PlayerCard
              key={player.id}
              player={player}
              isMe={player.id === playerId}
              isSpeaking={roomState.phase === 'speaking' && roomState.currentSpeakerIndex === idx}
              isVotable={roomState.phase === 'voting' && player.alive && player.id !== playerId && !myVote && me?.alive}
              isVoted={myVote === player.id}
              onVote={() => submitVote(player.id)}
              showRole={roomState.phase === 'game_over'}
            />
          ))}
        </div>
      </div>

      {/* 发言记录 */}
      {(roomState.phase === 'speaking' || roomState.phase === 'voting') && (
        <div className="card !p-4 space-y-2">
          <p className="text-xs font-bold text-violet-400">本轮发言</p>
          {roomState.players.filter(p => p.alive && p.speech).map(player => (
            <div key={player.id} className="flex items-start gap-2 text-sm">
              <span className="font-bold text-violet-600 shrink-0">
                {player.name}{player.id === playerId ? '(我)' : ''}:
              </span>
              {player.speech.type === 'text' ? (
                <span className="text-gray-700">{player.speech.content}</span>
              ) : (
                <audio
                  src={player.speech.content}
                  controls
                  className="h-8 max-w-[180px]"
                />
              )}
            </div>
          ))}
          {roomState.players.filter(p => p.alive && p.speech).length === 0 && (
            <p className="text-xs text-violet-300">暂无发言</p>
          )}
        </div>
      )}

      {/* 发言输入（自己的回合） */}
      {roomState.phase === 'speaking' && isMyTurn && me?.alive && (
        <div className="card !p-4 space-y-3 animate-bounce-in">
          <p className="text-sm font-bold text-violet-700 text-center">轮到你发言了！</p>
          <div className="flex gap-2">
            <input
              type="text"
              className="input-field !text-left !text-base flex-1"
              placeholder="输入你的描述..."
              value={speechText}
              onChange={(e) => setSpeechText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitTextSpeech()}
              maxLength={100}
            />
            <button
              className="px-4 rounded-2xl bg-gradient-to-r from-violet-500 to-purple-600 text-white font-bold active:scale-95 transition-all disabled:opacity-50"
              onClick={submitTextSpeech}
              disabled={!speechText.trim()}
            >
              发送
            </button>
          </div>
          <VoiceRecorder onRecorded={submitVoiceSpeech} />
        </div>
      )}

      {/* 等待发言 */}
      {roomState.phase === 'speaking' && !isMyTurn && currentSpeaker && (
        <div className="card !p-4 text-center">
          <p className="text-violet-500">
            等待 <span className="font-bold">{currentSpeaker.name}</span> 发言...
          </p>
        </div>
      )}

      {/* 投票面板 */}
      {roomState.phase === 'voting' && me?.alive && (
        <VotePanel
          players={roomState.players}
          playerId={playerId}
          myVote={myVote}
          onVote={submitVote}
        />
      )}

      {/* 投票结果 / 游戏结果 */}
      {showResult && voteResult && (
        <GameResult
          voteResult={voteResult}
          roomState={roomState}
          isHost={isHost}
          onNextRound={nextRound}
          onPlayAgain={playAgain}
          onClose={() => setShowResult(false)}
        />
      )}

      {/* 游戏结束但没有 voteResult（直接显示） */}
      {roomState.phase === 'game_over' && !showResult && (
        <div className="card !p-4 text-center space-y-4">
          <div className="text-4xl">
            {roomState.winner === 'civilian' ? '🎉' : '🕵️'}
          </div>
          <p className="text-xl font-black text-violet-700">
            {roomState.winner === 'civilian' ? '平民胜利！' : '卧底胜利！'}
          </p>
          {isHost && (
            <button className="btn-primary" onClick={playAgain}>
              再来一局
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DisconnectBanner({ playerName, totalSeconds }) {
  const [remaining, setRemaining] = useState(totalSeconds);
  const startTime = useRef(Date.now());

  useEffect(() => {
    startTime.current = Date.now();
    setRemaining(totalSeconds);
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime.current) / 1000);
      const left = Math.max(0, totalSeconds - elapsed);
      setRemaining(left);
      if (left <= 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [playerName, totalSeconds]);

  return (
    <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center space-y-2 animate-fade-in">
      <p className="text-sm font-bold text-red-600">
        玩家 <span className="text-red-700">{playerName}</span> 已掉线
      </p>
      <p className="text-xs text-red-500">
        等待重连中... 剩余 <span className="font-mono font-bold text-red-700">{remaining}</span> 秒
      </p>
      <div className="w-full bg-red-100 rounded-full h-1.5 overflow-hidden">
        <div
          className="h-full bg-red-400 rounded-full transition-all duration-1000 ease-linear"
          style={{ width: `${(remaining / totalSeconds) * 100}%` }}
        />
      </div>
      <p className="text-xs text-red-400">超时后游戏将中止，所有人回到房间</p>
    </div>
  );
}
