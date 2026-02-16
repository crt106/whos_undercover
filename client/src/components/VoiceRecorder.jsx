import { useState, useRef, useCallback, useEffect } from 'react';

export default function VoiceRecorder({ onRecorded }) {
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [micError, setMicError] = useState('');

  const streamRef = useRef(null);
  const mediaRecorder = useRef(null);
  const chunks = useRef([]);
  const btnRef = useRef(null);
  const isRecording = useRef(false);
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;

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
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setMicReady(true);
      setMicError('');
      return true;
    } catch (err) {
      console.error('Mic access denied:', err);
      setMicError('麦克风权限被拒绝');
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
    return (
      <div className="flex flex-col items-center gap-1">
        <button
          className="w-full py-3 rounded-2xl font-bold text-base bg-violet-100 text-violet-600 active:scale-95 transition-all select-none"
          onClick={requestMic}
        >
          🎤 点击开启麦克风
        </button>
        {micError && (
          <span className="text-xs text-red-500">{micError}</span>
        )}
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
