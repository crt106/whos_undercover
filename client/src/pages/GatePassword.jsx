import { useState, useEffect } from 'react';

const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 60;
const STORAGE_KEY = 'wuc_gate_attempts';

function getAttemptState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { count: 0, lockedUntil: 0 };
}

function saveAttemptState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function generateSessionId() {
  return 'sess_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export default function GatePassword({ onPass }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [loading, setLoading] = useState(false);

  // 检查是否处于锁定状态
  useEffect(() => {
    const checkLock = () => {
      const state = getAttemptState();
      const now = Date.now();
      if (state.lockedUntil > now) {
        setLocked(true);
        setCountdown(Math.ceil((state.lockedUntil - now) / 1000));
      } else {
        setLocked(false);
        setCountdown(0);
      }
    };

    checkLock();
    const timer = setInterval(checkLock, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (locked || !password.trim() || loading) return;

    setLoading(true);
    setError('');

    try {
      // 生成或获取 sessionId
      let sessionId = localStorage.getItem('gameSessionId');
      if (!sessionId) {
        sessionId = generateSessionId();
      }

      // 调用服务端验证接口
      const response = await fetch('/api/verify-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          password: password.trim(),
          sessionId,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // 验证成功，保存 sessionId
        localStorage.setItem('gameSessionId', sessionId);
        localStorage.removeItem(STORAGE_KEY);
        onPass();
        return;
      }

      // 密码错误
      const state = getAttemptState();
      state.count += 1;

      if (state.count >= MAX_ATTEMPTS) {
        state.lockedUntil = Date.now() + LOCKOUT_SECONDS * 1000;
        state.count = 0;
        setLocked(true);
        setCountdown(LOCKOUT_SECONDS);
        setError(`尝试次数过多，请 ${LOCKOUT_SECONDS} 秒后再试`);
      } else {
        setError(data.error || `密码错误，还剩 ${MAX_ATTEMPTS - state.count} 次机会`);
      }

      saveAttemptState(state);
      setPassword('');
    } catch (err) {
      setError('网络错误，请稍后再试');
    } finally {
      setLoading(false);
    }
  };

  const handleClearCache = () => {
    // 清除所有相关的本地存储
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('wuc_authed');
    localStorage.removeItem('gameSessionId');
    setError('');
    setPassword('');
    // 刷新页面以重新初始化状态
    window.location.reload();
  };

  return (
    <div className="card animate-fade-in space-y-6">
      <div className="text-center space-y-2">
        <div className="text-5xl">🔒</div>
        <h1 className="text-2xl font-black bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">
          输入访问密码
        </h1>
        <p className="text-violet-400 text-sm">请输入密码以进入游戏</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="password"
          className="input-field"
          placeholder="请输入密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={locked}
          autoFocus
        />

        {error && (
          <p className="text-center text-sm text-red-500 animate-fade-in">{error}</p>
        )}

        {locked && countdown > 0 && (
          <p className="text-center text-sm text-orange-500 bg-orange-50 rounded-xl py-2 px-4">
            请等待 {countdown} 秒后再尝试
          </p>
        )}

        <button
          type="submit"
          className="btn-primary"
          disabled={locked || !password.trim() || loading}
        >
          {loading ? '验证中...' : '进入'}
        </button>

        <button
          type="button"
          onClick={handleClearCache}
          className="btn-secondary text-sm"
          title="如果遇到认证问题，可以尝试清除缓存"
        >
          清除缓存并刷新
        </button>
      </form>

      <div className="text-center text-xs text-gray-500 space-y-1">
        <p>💡 提示：如果页面显示异常，可以点击"清除缓存并刷新"</p>
        <p>支持URL直接访问：?password=密码 或 ?pwd=密码</p>
      </div>
    </div>
  );
}
