import { useState, useEffect, useRef, useImperativeHandle, forwardRef, useMemo } from 'react';
import socket from '../socket';

const MAX_LEN = 200;

const PrivateChatPanel = forwardRef(function PrivateChatPanel({ roomState, playerId }, ref) {
  const [open, setOpen] = useState(false);
  const [activePeerId, setActivePeerId] = useState(null);
  const [messages, setMessages] = useState([]); // 全部相关消息平铺
  const [unreadByPeer, setUnreadByPeer] = useState({}); // peerId -> count
  const [draft, setDraft] = useState('');
  const listRef = useRef(null);
  const activePeerIdRef = useRef(null);
  const openRef = useRef(false);

  activePeerIdRef.current = activePeerId;
  openRef.current = open;

  const me = roomState.players.find(p => p.id === playerId);
  const myAlive = me?.alive !== false;

  // 暴露给父组件：让 PlayerCard 点击能直接打开特定对话
  useImperativeHandle(ref, () => ({
    openWith(peerId) {
      setActivePeerId(peerId);
      setOpen(true);
      setUnreadByPeer(prev => {
        if (!prev[peerId]) return prev;
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
    },
  }), []);

  // 初次挂载拉历史
  useEffect(() => {
    socket.emit('request-private-history', null, (res) => {
      if (res?.messages) {
        setMessages(res.messages);
        // 拉到的历史里自己作为接收方且未读视为已读（简化处理）：不计未读
      }
    });
  }, []);

  // 监听新消息
  useEffect(() => {
    const handler = (msg) => {
      setMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      const peerId = msg.fromId === playerId ? msg.toId : msg.fromId;
      const incoming = msg.toId === playerId;
      if (incoming) {
        // 当前正打开且是该 peer 的对话则视为已读
        if (openRef.current && activePeerIdRef.current === peerId) return;
        setUnreadByPeer(prev => ({ ...prev, [peerId]: (prev[peerId] || 0) + 1 }));
      }
    };
    socket.on('private-message', handler);
    return () => socket.off('private-message', handler);
  }, [playerId]);

  // 阶段切换到 game_over 时关闭面板（结束后由归档区接管）
  useEffect(() => {
    if (roomState.phase === 'game_over') {
      setOpen(false);
    }
  }, [roomState.phase]);

  // 切换 active peer 时清未读 + 滚到底
  useEffect(() => {
    if (!activePeerId) return;
    setUnreadByPeer(prev => {
      if (!prev[activePeerId]) return prev;
      const next = { ...prev };
      delete next[activePeerId];
      return next;
    });
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    });
  }, [activePeerId, open]);

  // 当前对话有新消息时自动滚到底
  const activeMessages = useMemo(() => {
    if (!activePeerId) return [];
    return messages.filter(m =>
      (m.fromId === playerId && m.toId === activePeerId) ||
      (m.fromId === activePeerId && m.toId === playerId)
    );
  }, [messages, activePeerId, playerId]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [activeMessages.length]);

  const totalUnread = Object.values(unreadByPeer).reduce((a, b) => a + b, 0);

  // 会话列表：所有非自己的玩家（含死人）
  const peerList = roomState.players.filter(p => p.id !== playerId);

  const sendMessage = () => {
    const text = draft.trim();
    if (!text || !activePeerId) return;
    if (!myAlive) return;
    socket.emit('send-private-message', { targetId: activePeerId, content: text }, (res) => {
      if (res?.error) {
        console.error('send-private-message:', res.error);
        return;
      }
      // 服务端会把消息回推给自己，去重逻辑在 handler 里
    });
    setDraft('');
  };

  // game_over 阶段不渲染面板（归档区接管）；waiting 阶段也允许私聊
  if (roomState.phase === 'game_over') return null;

  return (
    <>
      {/* 右下角悬浮按钮 */}
      {!open && (
        <button
          onClick={() => {
            setOpen(true);
            // 自动选第一个有未读的 peer，或第一个有历史的 peer，或第一个 peer
            const unreadPeer = Object.keys(unreadByPeer).find(id => unreadByPeer[id] > 0);
            const peerWithHistory = peerList.find(p =>
              messages.some(m => m.fromId === p.id || m.toId === p.id)
            );
            const fallback = unreadPeer || peerWithHistory?.id || peerList[0]?.id || null;
            if (!activePeerId) setActivePeerId(fallback);
          }}
          className="fixed bottom-4 right-4 z-30 w-14 h-14 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-xl shadow-violet-300/50 active:scale-90 transition-all flex items-center justify-center"
          aria-label="打开私聊"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {totalUnread > 0 && (
            <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center border-2 border-white">
              {totalUnread > 99 ? '99+' : totalUnread}
            </span>
          )}
        </button>
      )}

      {/* 抽屉 */}
      {open && (
        <div className="fixed inset-0 z-40 flex items-end justify-center" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="relative w-full max-w-md bg-white rounded-t-3xl shadow-2xl flex flex-col animate-fade-in"
            style={{ height: '70vh', maxHeight: '560px' }}
            onClick={e => e.stopPropagation()}
          >
            {/* 顶部 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-violet-100">
              <span className="font-black text-violet-700">💬 私聊</span>
              <button
                className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400"
                onClick={() => setOpen(false)}
                aria-label="关闭"
              >
                ✕
              </button>
            </div>

            {/* 会话 Tab 横滚 */}
            <div className="flex overflow-x-auto border-b border-violet-100" style={{ scrollbarWidth: 'none' }}>
              {peerList.map(p => {
                const isActive = p.id === activePeerId;
                const unread = unreadByPeer[p.id] || 0;
                return (
                  <button
                    key={p.id}
                    onClick={() => setActivePeerId(p.id)}
                    className={`relative flex-shrink-0 px-4 py-2.5 text-xs font-bold transition-colors border-b-2 ${
                      isActive
                        ? 'text-violet-700 border-violet-500 bg-violet-50'
                        : 'text-violet-400 border-transparent hover:text-violet-600'
                    } ${p.alive === false ? 'opacity-60' : ''}`}
                  >
                    {p.name}{p.alive === false ? '(已淘汰)' : ''}
                    {unread > 0 && (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] leading-none bg-red-500 text-white">
                        {unread > 99 ? '99+' : unread}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* 消息列表 */}
            <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-gray-50">
              {!activePeerId && (
                <p className="text-center text-xs text-gray-400 mt-4">选择一位玩家开始对话</p>
              )}
              {activePeerId && activeMessages.length === 0 && (
                <p className="text-center text-xs text-gray-400 mt-4">还没有消息，发送第一条试试</p>
              )}
              {activeMessages.map(m => {
                const mine = m.fromId === playerId;
                return (
                  <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[78%] px-3 py-2 rounded-2xl text-sm break-words ${
                      mine
                        ? 'bg-gradient-to-br from-violet-500 to-purple-600 text-white rounded-br-sm'
                        : 'bg-white text-gray-700 border border-violet-100 rounded-bl-sm'
                    }`}>
                      <p>{m.content}</p>
                      <p className={`text-[10px] mt-1 ${mine ? 'text-violet-100' : 'text-gray-400'}`}>
                        {m.speechLabel || '等待中'}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 输入区 */}
            <div className="border-t border-violet-100 p-3 space-y-2">
              {!myAlive && (
                <p className="text-xs text-center text-red-500">你已被淘汰，仅可查看消息</p>
              )}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={draft}
                  onChange={e => setDraft(e.target.value.slice(0, MAX_LEN))}
                  onKeyDown={e => e.key === 'Enter' && sendMessage()}
                  placeholder={!activePeerId ? '请先选择对话' : (myAlive ? '输入消息...' : '已被淘汰')}
                  disabled={!myAlive || !activePeerId}
                  maxLength={MAX_LEN}
                  className="flex-1 px-3 py-2 rounded-xl border-2 border-violet-100 bg-white text-sm focus:outline-none focus:border-violet-400 disabled:bg-gray-100 disabled:text-gray-400"
                />
                <button
                  onClick={sendMessage}
                  disabled={!myAlive || !activePeerId || !draft.trim()}
                  className="px-4 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white font-bold text-sm active:scale-95 transition-all disabled:opacity-40"
                >
                  发送
                </button>
              </div>
              {draft.length > MAX_LEN * 0.7 && (
                <p className="text-[10px] text-right text-gray-400">{draft.length}/{MAX_LEN}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
});

export default PrivateChatPanel;
