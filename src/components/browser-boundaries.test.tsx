// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { VoiceButton } from './VoiceButton';
import { ProtectedRoute } from './ProtectedRoute';
import { BootScreen, ErrorBoundary } from './Boot';
import { useAuthStore } from '../store/auth-store';

const mocks = vi.hoisted(() => ({ transcribe: vi.fn() }));
vi.mock('../api/ai', () => ({ transcribeAudio: mocks.transcribe }));
vi.mock('../lib/audio', () => ({
  encodePcm16Wav: vi.fn(() => new Blob(['wav bytes'], { type: 'audio/wav' })),
}));

class FakeRecorder {
  static emitData = true;
  static isTypeSupported = vi.fn((format: string) => format === 'audio/webm;codecs=opus');
  state = 'inactive';
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: MediaStream, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? 'audio/webm';
  }
  start() {
    this.state = 'recording';
    if (FakeRecorder.emitData)
      this.ondataavailable?.({ data: new Blob(['recorded speech'], { type: this.mimeType }) });
  }
  stop() {
    this.state = 'inactive';
    this.onstop?.();
  }
}

function makeStream() {
  const stop = vi.fn();
  return { stream: { getTracks: () => [{ stop }] } as unknown as MediaStream, stop };
}

beforeEach(() => {
  mocks.transcribe.mockReset();
  FakeRecorder.emitData = true;
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal(
    'AudioContext',
    class {
      decodeAudioData = vi.fn(async () => ({}) as AudioBuffer);
      close = vi.fn(async () => undefined);
    },
  );
});

describe('VoiceButton browser recording flow', () => {
  it('records, releases the microphone, converts to WAV and sends the selected language/order', async () => {
    const { stream, stop } = makeStream();
    const getUserMedia = vi.fn(async () => stream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    mocks.transcribe.mockResolvedValue({ text: '  Насос проверен  ' });
    const onText = vi.fn();
    renderWithProviders(<VoiceButton onText={onText} workOrderId="wo-17" />);

    fireEvent.click(screen.getByRole('button', { name: 'Голосовой ввод' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Запись идёт');
    fireEvent.click(screen.getByRole('button', { name: 'Остановить запись' }));

    await waitFor(() => expect(onText).toHaveBeenCalledWith('Насос проверен'));
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    expect(mocks.transcribe).toHaveBeenCalledTimes(1);
    const [wav, workOrderId, language] = mocks.transcribe.mock.calls[0] as [Blob, string, string];
    expect(wav.type).toBe('audio/wav');
    expect(workOrderId).toBe('wo-17');
    expect(language).toBe('ru');
    expect(stop).toHaveBeenCalledOnce();
  });

  it('shows a useful permission error when browser access is denied', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => {
          throw new Error('permission denied');
        }),
      },
    });
    renderWithProviders(<VoiceButton onText={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Голосовой ввод' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Нет доступа к микрофону');
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it('reports empty recordings instead of submitting empty audio', async () => {
    const { stream } = makeStream();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => stream) },
    });
    FakeRecorder.emitData = false;
    renderWithProviders(<VoiceButton onText={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Голосовой ввод' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Остановить запись' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Речь не распознана');
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it('shows a conversion error and never calls transcription when audio decoding fails', async () => {
    const { stream } = makeStream();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => stream) },
    });
    vi.stubGlobal(
      'AudioContext',
      class {
        decodeAudioData = vi.fn(async () => {
          throw new Error('invalid recording');
        });
        close = vi.fn(async () => undefined);
      },
    );
    renderWithProviders(<VoiceButton onText={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Голосовой ввод' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Остановить запись' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось обработать запись');
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });
});

function ProtectedHarness({ allow }: { allow: ('worker' | 'master' | 'manager' | 'admin')[] }) {
  return (
    <ProtectedRoute allow={allow}>
      <span>protected content</span>
    </ProtectedRoute>
  );
}

describe('ProtectedRoute session and role gates', () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
    useAuthStore.setState({ bootstrapped: false });
  });

  it('keeps the boot screen while session restoration is incomplete', () => {
    renderWithProviders(<ProtectedHarness allow={['worker']} />);
    expect(screen.getByRole('status', { name: 'НарядAI' })).toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('redirects a bootstrapped anonymous session away from protected content', () => {
    useAuthStore.setState({ bootstrapped: true });
    renderWithProviders(<ProtectedHarness allow={['worker']} />, { route: '/private' });
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('redirects a signed-in user when the role is not allowed', () => {
    useAuthStore
      .getState()
      .setSession(
        { id: 'u1', login: 'worker1', full_name: 'Worker', role: 'worker', area_ids: [] },
        'access',
        'refresh',
      );
    useAuthStore.setState({ bootstrapped: true });
    renderWithProviders(<ProtectedHarness allow={['admin']} />, { route: '/private' });
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('renders allowed content for the signed-in role', () => {
    useAuthStore
      .getState()
      .setSession(
        { id: 'u1', login: 'worker1', full_name: 'Worker', role: 'worker', area_ids: [] },
        'access',
        'refresh',
      );
    useAuthStore.setState({ bootstrapped: true });
    renderWithProviders(<ProtectedHarness allow={['worker']} />);
    expect(screen.getByText('protected content')).toBeInTheDocument();
  });
});

describe('Boot and error recovery UI', () => {
  it('renders the named startup status and optional diagnostic note', () => {
    renderWithProviders(<BootScreen note="reconnecting" />);
    expect(screen.getByRole('status', { name: 'НарядAI' })).toHaveTextContent('reconnecting');
  });

  it('replaces a crashed subtree with a restart affordance', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Crash(): never {
      throw new Error('render failed');
    }
    renderWithProviders(
      <ErrorBoundary>
        <Crash />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('heading', { name: 'Не удалось открыть экран' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Перезапустить' })).toBeInTheDocument();
    error.mockRestore();
  });
});
