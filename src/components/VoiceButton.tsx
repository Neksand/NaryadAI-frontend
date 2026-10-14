import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { transcribeAudio } from '../api/ai';
import { toLocalizedError } from '../lib/api-client';
import { encodePcm16Wav } from '../lib/audio';
import { Icon } from './Icon';

interface SpeechResultLike {
  transcript: string;
}
interface SpeechEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: SpeechResultLike }>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike;
}

function speechRecognitionConstructor(): SpeechRecognitionConstructor | undefined {
  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

async function recordingAsWav(recording: Blob): Promise<Blob> {
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData(await recording.arrayBuffer());
    return encodePcm16Wav(audio);
  } finally {
    await context.close().catch(() => undefined);
  }
}

/** Records in the WebView's native format, converts to PCM WAV, then uses local transcription. */
export function VoiceButton({
  onText,
  workOrderId,
}: {
  onText: (text: string) => void;
  workOrderId?: string;
}) {
  const { t, i18n } = useTranslation();
  const rec = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stopTimer = useRef<number | null>(null);
  const speechStopTimer = useRef<number | null>(null);
  const speech = useRef<SpeechRecognitionLike | null>(null);
  const speechText = useRef('');
  const speechOnly = useRef(false);
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [usedSpeechFallback, setUsedSpeechFallback] = useState(false);

  const startSpeechFallback = (): boolean => {
    const Constructor = speechRecognitionConstructor();
    if (!Constructor) return false;
    try {
      speechText.current = '';
      const recognition = new Constructor();
      recognition.lang = (i18n.language || 'ru').slice(0, 2) === 'kk' ? 'kk-KZ' : 'ru-RU';
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.onresult = (event) => {
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          if (event.results[index]?.isFinal)
            speechText.current += `${event.results[index][0].transcript} `;
        }
      };
      recognition.onerror = () => undefined;
      recognition.onend = () => {
        if (speech.current === recognition) speech.current = null;
      };
      recognition.start();
      speech.current = recognition;
      return true;
    } catch {
      return false;
    }
  };

  const stopSpeech = (abort = false) => {
    if (speechStopTimer.current !== null) window.clearTimeout(speechStopTimer.current);
    speechStopTimer.current = null;
    const active = speech.current;
    speech.current = null;
    try {
      if (active) {
        if (abort) active.abort();
        else active.stop();
      }
    } catch {
      /* already ended */
    }
  };

  const consumeBrowserTranscript = () => {
    const text = speechText.current.trim();
    stopSpeech(true);
    if (!text) return false;
    onText(text);
    setMicError(null);
    setUsedSpeechFallback(true);
    return true;
  };

  const waitForBrowserTranscript = async () => {
    if (speech.current) {
      try {
        speech.current.stop();
      } catch {
        /* already ended */
      }
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
    return consumeBrowserTranscript();
  };

  const m = useMutation({
    mutationFn: (blob: Blob) =>
      transcribeAudio(blob, workOrderId, (i18n.language || 'ru').slice(0, 2)),
    onSuccess: (result) => {
      const text = result.text.trim();
      if (text) {
        onText(text);
        setMicError(null);
      } else {
        setMicError(t('voice.noSpeech'));
      }
    },
  });

  useEffect(
    () => () => {
      if (stopTimer.current !== null) window.clearTimeout(stopTimer.current);
      if (speechStopTimer.current !== null) window.clearTimeout(speechStopTimer.current);
      stopSpeech(true);
      if (rec.current?.state === 'recording') rec.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const toggle = async () => {
    if (recording) {
      if (speechOnly.current) {
        speechOnly.current = false;
        stopSpeech();
        window.setTimeout(() => {
          if (!consumeBrowserTranscript()) setMicError(t('voice.noSpeech'));
        }, 500);
      }
      if (rec.current?.state === 'recording') rec.current.stop();
      setRecording(false);
      return;
    }

    let stream: MediaStream | null = null;
    try {
      setMicError(null);
      setUsedSpeechFallback(false);
      m.reset();
      const webSpeechAvailable = startSpeechFallback();
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        if (webSpeechAvailable) {
          speechOnly.current = true;
          setRecording(true);
          return;
        }
        throw new Error('Microphone recording is unavailable in this WebView');
      }
      const activeStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      stream = activeStream;
      streamRef.current = activeStream;
      const formats = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4;codecs=mp4a.40.2',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ];
      const mimeType =
        typeof MediaRecorder.isTypeSupported === 'function'
          ? formats.find((format) => MediaRecorder.isTypeSupported(format))
          : undefined;
      const recorder = mimeType
        ? new MediaRecorder(activeStream, { mimeType })
        : new MediaRecorder(activeStream);
      chunks.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      recorder.onstop = () => {
        if (stopTimer.current !== null) window.clearTimeout(stopTimer.current);
        stopTimer.current = null;
        activeStream.getTracks().forEach((track) => track.stop());
        if (streamRef.current === activeStream) streamRef.current = null;
        setRecording(false);
        const recordingBlob = new Blob(chunks.current, {
          type: recorder.mimeType || chunks.current[0]?.type || 'application/octet-stream',
        });
        if (!recordingBlob.size) {
          speechStopTimer.current = window.setTimeout(() => {
            void waitForBrowserTranscript().then((found) => {
              if (!found) setMicError(t('voice.noSpeech'));
            });
          }, 500);
          return;
        }
        setProcessing(true);
        speechStopTimer.current = window.setTimeout(() => stopSpeech(), 1500);
        void (async () => {
          try {
            const wav = await recordingAsWav(recordingBlob);
            try {
              const result = await m.mutateAsync(wav);
              if (!result.text.trim()) await waitForBrowserTranscript();
              else stopSpeech(true);
            } catch {
              if (!(await waitForBrowserTranscript())) setMicError(t('voice.transcriptionFailed'));
            }
          } catch {
            if (!(await waitForBrowserTranscript())) setMicError(t('voice.formatError'));
          } finally {
            stopSpeech(true);
            setProcessing(false);
          }
        })();
      };
      rec.current = recorder;
      recorder.start(250);
      setRecording(true);
      stopTimer.current = window.setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, 60_000);
    } catch {
      stopSpeech(true);
      stream?.getTracks().forEach((track) => track.stop());
      if (streamRef.current === stream) streamRef.current = null;
      setMicError(t('voice.denied'));
    }
  };

  const busy = processing || m.isPending;
  const error =
    micError ?? (m.isError && !usedSpeechFallback ? toLocalizedError(m.error).message : null);

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        className={`btn btn-sm ${recording ? 'btn-danger' : ''}`}
        onClick={toggle}
        disabled={busy}
        aria-label={recording ? t('voice.stop') : t('voice.start')}
        aria-pressed={recording}
        title={t('voice.title')}
      >
        {busy ? (
          <Icon name="refresh" size={16} />
        ) : recording ? (
          <>
            <Icon name="stop" size={14} />
            <span className="rec-dot" aria-hidden="true" />
          </>
        ) : (
          <Icon name="mic" size={18} />
        )}
      </button>
      {recording && (
        <span className="chip warn" role="status">
          {t('voice.recordingStatus')}
        </span>
      )}
      {busy && (
        <span className="chip info" role="status">
          {t('voice.processingStatus')}
        </span>
      )}
      {error && (
        <span className="chip danger" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
