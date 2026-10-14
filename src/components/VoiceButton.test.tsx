// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VoiceButton } from './VoiceButton';
import { renderWithProviders } from '../test-utils';

const transcribeMock = vi.hoisted(() => vi.fn());
vi.mock('../api/ai', () => ({ transcribeAudio: transcribeMock }));

let recognition: FakeSpeechRecognition | undefined;
class FakeSpeechRecognition {
  lang = '';
  continuous = false;
  interimResults = false;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
      }) => void)
    | null = null;
  onerror: (() => void) | null = null;
  onend: (() => void) | null = null;
  start() {
    recognition = this;
  }
  stop() {
    this.onresult?.({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: 'Заменил насос' } }],
    });
    this.onend?.();
  }
  abort() {
    this.onend?.();
  }
}

class FakeMediaRecorder {
  static isTypeSupported() {
    return true;
  }
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: unknown, _options?: unknown) {}
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['audio']) });
    this.onstop?.();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  recognition = undefined;
  Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: undefined });
  Object.defineProperty(window, 'webkitSpeechRecognition', {
    configurable: true,
    value: undefined,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
});

describe('VoiceButton browser fallback', () => {
  it('uses browser speech recognition when this WebView has no MediaRecorder', async () => {
    Object.defineProperty(window, 'webkitSpeechRecognition', {
      configurable: true,
      value: FakeSpeechRecognition,
    });
    vi.stubGlobal('MediaRecorder', undefined);
    const onText = vi.fn();
    renderWithProviders(<VoiceButton onText={onText} />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Голосовой ввод' }));
    expect(recognition?.lang).toBe('ru-RU');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Остановить запись' }));
    await waitFor(() => expect(onText).toHaveBeenCalledWith('Заменил насос'));
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it('keeps local transcription primary and inserts its result when available', async () => {
    const tracks = [{ stop: vi.fn() }];
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => tracks })) },
    });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    vi.stubGlobal(
      'AudioContext',
      class {
        close = vi.fn(async () => undefined);
        decodeAudioData = vi.fn(async () => ({
          duration: 1,
          length: 2,
          numberOfChannels: 1,
          sampleRate: 16_000,
          getChannelData: () => new Float32Array([0.1, 0.2]),
        }));
      },
    );
    transcribeMock.mockResolvedValue({ text: 'Заменил подшипник', confidence: 0.9 });
    const onText = vi.fn();
    renderWithProviders(<VoiceButton onText={onText} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Голосовой ввод' }));
    await user.click(screen.getByRole('button', { name: 'Остановить запись' }));
    await waitFor(() => expect(onText).toHaveBeenCalledWith('Заменил подшипник'));
    expect(transcribeMock).toHaveBeenCalledTimes(1);
    expect(tracks[0].stop).toHaveBeenCalled();
  });

  it('falls back to browser transcript when the local transcription request fails', async () => {
    Object.defineProperty(window, 'SpeechRecognition', {
      configurable: true,
      value: FakeSpeechRecognition,
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) },
    });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    vi.stubGlobal(
      'AudioContext',
      class {
        close = vi.fn(async () => undefined);
        decodeAudioData = vi.fn(async () => ({
          duration: 1,
          length: 2,
          numberOfChannels: 1,
          sampleRate: 16_000,
          getChannelData: () => new Float32Array([0.1, 0.2]),
        }));
      },
    );
    transcribeMock.mockRejectedValue(new Error('backend unavailable'));
    const onText = vi.fn();
    renderWithProviders(<VoiceButton onText={onText} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Голосовой ввод' }));
    await user.click(screen.getByRole('button', { name: 'Остановить запись' }));
    await waitFor(() => expect(onText).toHaveBeenCalledWith('Заменил насос'));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
