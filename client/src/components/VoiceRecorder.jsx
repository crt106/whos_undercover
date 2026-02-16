import { useState, useRef, useCallback, useEffect } from 'react';

export default function VoiceRecorder({ onRecorded }) {
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [micError, setMicError] = useState('');
  const [permissionState, setPermissionState] = useState('prompt'); // 'prompt' | 'granted' | 'denied'

  const streamRef = useRef(null);
  const mediaRecorder = useRef(null);
  const chunks = useRef([]);
  const btnRef = useRef(null);
  const isRecording = useRef(false);
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;

  // 检查麦克风权限状态
  useEffect(() => {
    const checkPermission = async () => {
      // 检查是否支持 mediaDevices
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setMicError('您的浏览器不支持录音功能');
        setPermissionState('denied');
        return;
      }

      // 使用 Permissions API 检查权限状态（如果支持）
      if (navigator.permissions && navigator.permissions.query) {
        try {
          const result = await navigator.permissions.query({ name: 'microphone' });
          setPermissionState(result.state);

          // 监听权限变化
          result.onchange = () => {
            setPermissionState(result.state);
            if (result.state === 'denied') {
              setMicError('麦克风权限被拒绝，请在浏览器设置中开启');
              setMicReady(false);
            } else if (result.state === 'granted') {
              setMicError('');
            }
          };
        } catch (e) {
          // 某些浏览器不支持 microphone 权限查询，忽略错误
          console.log('Permission query not supported:', e);
        }
      }
    };

    checkPermission();
  }, []);

  // 组件卸载时释放 stream
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // 请求麦克风权限（需要用户手势触发）
  const requestMic = useCallback(async () => {
    if (streamRef.current) {
      setMicReady(true);
      return true;
    }

    // 清除之前的错误
    setMicError('');

    // 检查基本支持
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMicError('您的浏览器不支持录音功能，请使用 Chrome 或 Safari');
      return false;
    }

    try {
      // 使用更宽松的约束，提高兼容性
      const constraints = {
        audio: {
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: true },
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      setMicReady(true);
      setMicError('');
      setPermissionState('granted');
      return true;
    } catch (err) {
      console.error('Mic access error:', err);

      // 根据错误类型给出更具体的提示
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setPermissionState('denied');
        setMicError('麦克风权限被拒绝，请点击地址栏左侧的锁图标开启权限');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setMicError('未检测到麦克风设备');
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setMicError('麦克风被其他应用占用，请关闭后重试');
      } else if (err.name === 'OverconstrainedError') {
        // 约束过严，尝试使用最简单的约束重试
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          streamRef.current = stream;
          setMicReady(true);
          setMicError('');
          setPermissionState('granted');
          return true;
        } catch (retryErr) {
          setMicError('无法访问麦克风');
        }
      } else {
        setMicError('无法访问麦克风: ' + (err.message || err.name));
      }
      return false;
    }
  }, []);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || isRecording.current) return;

    // 选择 mimeType
    let mimeType = '';
    if (typeof MediaRecorder.isTypeSupported === 'function') {
      for (const type of ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav']) {
        if (MediaRecorder.isTypeSupported(type)) {
          mimeType = type;
          break;
        }
      }
    }

    try {
      const options = mimeType ? { mimeType } : undefined;
      const recorder = new MediaRecorder(stream, options);

      chunks.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunks.current, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size < 500) return; // 太短，忽略

        setUploading(true);
        try {
          const ext = (recorder.mimeType || '').includes('mp4') ? '.mp4' : '.webm';
          const formData = new FormData();
          formData.append('voice', blob, `voice${ext}`);
          const res = await fetch('/api/upload-voice', { method: 'POST', body: formData });
          const data = await res.json();
          if (data.url) onRecordedRef.current(data.url);
        } catch (err) {
          console.error('Upload failed:', err);
        }
        setUploading(false);
      };

      mediaRecorder.current = recorder;
      recorder.start();
      isRecording.current = true;
      setRecording(true);
    } catch (err) {
      console.error('MediaRecorder error:', err);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (!isRecording.current) return;
    isRecording.current = false;
    setRecording(false);
    if (mediaRecorder.current && mediaRecorder.current.state === 'recording') {
      mediaRecorder.current.stop();
    }
  }, []);

  // 绑定 touch 事件（non-passive 以支持 preventDefault）
  useEffect(() => {
    const btn = btnRef.current;
    if (!btn) return;

    const onTouchStart = (e) => {
      e.preventDefault();
      // 麦克风未就绪时不处理（用户需要先点击开启按钮）
      if (!streamRef.current) return;
      startRecording();
    };

    const onTouchEnd = (e) => {
      e.preventDefault();
      stopRecording();
    };

    const onContextMenu = (e) => {
      e.preventDefault(); // 阻止移动端长按弹出菜单
    };

    btn.addEventListener('touchstart', onTouchStart, { passive: false });
    btn.addEventListener('touchend', onTouchEnd, { passive: false });
    btn.addEventListener('touchcancel', onTouchEnd, { passive: false });
    btn.addEventListener('contextmenu', onContextMenu);

    return () => {
      btn.removeEventListener('touchstart', onTouchStart);
      btn.removeEventListener('touchend', onTouchEnd);
      btn.removeEventListener('touchcancel', onTouchEnd);
      btn.removeEventListener('contextmenu', onContextMenu);
    };
  }, [startRecording, stopRecording]);

  if (uploading) {
    return (
      <div className="text-center text-sm text-violet-400 py-2">
        正在上传语音...
      </div>
    );
  }

  // 麦克风未就绪：显示"点击开启麦克风"按钮
  if (!micReady) {
    // 权限被永久拒绝时，显示引导信息
    if (permissionState === 'denied') {
      return (
        <div className="flex flex-col items-center gap-2">
          <div className="w-full py-3 px-4 rounded-2xl bg-gray-100 text-gray-500 text-center">
            <div className="text-sm font-medium mb-1">麦克风权限已被禁用</div>
            <div className="text-xs text-gray-400">
              请点击地址栏左侧的 🔒 图标 → 网站设置 → 开启麦克风权限，然后刷新页面
            </div>
          </div>
          {micError && (
            <span className="text-xs text-red-500">{micError}</span>
          )}
          <button
            className="text-xs text-violet-500 underline"
            onClick={() => window.location.reload()}
          >
            刷新页面重试
          </button>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center gap-1">
        <button
          className="w-full py-3 rounded-2xl font-bold text-base bg-violet-100 text-violet-600 active:scale-95 transition-all select-none"
          onClick={requestMic}
        >
          🎤 点击开启麦克风
        </button>
        {micError && (
          <span className="text-xs text-red-500 text-center px-2">{micError}</span>
        )}
        <span className="text-xs text-gray-400">
          点击后请在弹窗中选择「允许」
        </span>
      </div>
    );
  }

  // 麦克风已就绪：长按录音
  return (
    <div className="flex justify-center">
      <button
        ref={btnRef}
        className={`w-full py-3 rounded-2xl font-bold text-base transition-all select-none touch-none ${
          recording
            ? 'bg-red-500 text-white shadow-lg shadow-red-200 animate-pulse'
            : 'bg-violet-100 text-violet-600'
        }`}
        style={{
          WebkitTouchCallout: 'none',
          WebkitUserSelect: 'none',
          userSelect: 'none',
        }}
        onMouseDown={startRecording}
        onMouseUp={stopRecording}
        onMouseLeave={stopRecording}
      >
        {recording ? '🎙️ 松开发送语音' : '🎤 按住录音'}
      </button>
    </div>
  );
}
