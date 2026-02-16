import { useState, useEffect } from 'react';

const GATE_PASSWORD = import.meta.env.VITE_GATE_PASSWORD;
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

export default function GatePassword({ onPass }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // 检查环境变量是否配置
  if (!GATE_PASSWORD) {
    return (
      <div className="card animate-fade-in space-y-6">
        <div className="text-center space-y-2">
          <div className="text-5xl">⚠️</div>
          <h1 className="text-2xl font-black bg-gradient-to-r from-red-600 to-orange-600 bg-clip-text text-transparent">
            配置错误
          </h1>
          <p className="text-red-500 text-sm">
            环境变量 VITE_GATE_PASSWORD 未配置
          </p>
          <p className="text-gray-600 text-xs">
            请在 .env 文件中设置 VITE_GATE_PASSWORD 变量
          </p>
        </div>
      </div>
    );
  }

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

  const handleSubmit = (e) => {
    e.preventDefault();
    if (locked || !password.trim()) return;

    if (password.trim() === GATE_PASSWORD) {
      // 清除失败记录
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
      setError(`密码错误，还剩 ${MAX_ATTEMPTS - state.count} 次机会`);
    }

    saveAttemptState(state);
    setPassword('');
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
          disabled={locked || !password.trim()}
        >
          进入
        </button>
      </form>
    </div>
  );
}
