import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { transcribeAudio } from '../api/ai';
import { toLocalizedError } from '../lib/api-client';

/** Voice → text via POST /ai/transcribe. 60s max, result appended to the bound field. */
export function VoiceButton({ onText, workOrderId }: { onText: (text: string) => void; workOrderId?: string }) {
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);

  const m = useMutation({
    mutationFn: (blob: Blob) => transcribeAudio(blob, workOrderId),
    onSuccess: (d) => { if (d.text) onText(d.text); },
  });

  const toggle = async () => {
    if (recording) {
      rec.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : undefined });
      chunks.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: 'audio/webm' });
        if (blob.size) m.mutate(blob);
      };
      rec.current = mr;
      mr.start();
      setRecording(true);
      // safety cap 60s (backend limit)
      setTimeout(() => { if (mr.state === 'recording') { mr.stop(); setRecording(false); } }, 60000);
    } catch {
      // mic denied — stay silent, text input remains
    }
  };

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button" className={`btn btn-sm ${recording ? 'btn-danger' : ''}`}
        onClick={toggle} disabled={m.isPending} aria-label={recording ? 'Остановить запись' : 'Голосовой ввод'}
        aria-pressed={recording} title="Голосовой ввод (до 60 с)"
      >
        {m.isPending ? '…' : recording ? '■ ●' : '🎙'}
      </button>
      {m.isError && <span className="chip danger">{toLocalizedError(m.error).message}</span>}
    </span>
  );
}
