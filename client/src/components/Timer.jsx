import { useState, useEffect } from 'react';

export default function Timer({ seconds }) {
  const [left, setLeft] = useState(seconds);

  useEffect(() => {
    setLeft(seconds);
    const timer = setInterval(() => {
      setLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [seconds]);

  const isLow = left <= 10;

  return (
    <span className={`text-sm font-bold tabular-nums ${
      isLow ? 'text-red-500 animate-pulse' : 'text-violet-400'
    }`}>
      {left}s
    </span>
  );
}
