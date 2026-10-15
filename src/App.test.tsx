// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from './test-utils';
import App from './App';
import { useAuthStore } from './store/auth-store';
import type { User } from './types/domain';

const mocks = vi.hoisted(() => ({
  getRefreshToken: vi.fn(),
  refreshSession: vi.fn(),
  fetchMe: vi.fn(),
  isNetworkFailure: vi.fn(),
}));
vi.mock('./lib/api-client', () => ({
  setTokens: vi.fn(),
  getRefreshToken: mocks.getRefreshToken,
  refreshSession: mocks.refreshSession,
  isNetworkFailure: mocks.isNetworkFailure,
}));
vi.mock('./api/auth', () => ({ fetchMe: mocks.fetchMe }));
vi.mock('./pages/Login', () => ({ default: () => <div>login screen</div> }));
vi.mock('./pages/WorkerHome', () => ({ default: () => <div>worker screen</div> }));

const worker: User = {
  id: 'worker-id',
  login: 'worker',
  full_name: 'Test worker',
  role: 'worker',
  area_ids: [],
};

beforeEach(() => {
  mocks.getRefreshToken.mockReset();
  mocks.getRefreshToken.mockReturnValue(null);
  mocks.refreshSession.mockReset();
  mocks.fetchMe.mockReset();
  mocks.isNetworkFailure.mockReturnValue(false);
  useAuthStore.getState().logout();
  useAuthStore.setState({ bootstrapped: false });
});

afterEach(() => vi.useRealTimers());

function cacheWorker() {
  useAuthStore.getState().setSession(worker, 'old-access', 'refresh-token');
  useAuthStore.setState({ user: null, role: null, accessToken: null, bootstrapped: false });
  mocks.getRefreshToken.mockReturnValue('refresh-token');
}

function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('application route and session bootstrap', () => {
  it('opens login directly and completes bootstrap without a saved refresh token', async () => {
    renderWithProviders(<App />, { route: '/login' });
    expect(await screen.findByText('login screen')).toBeInTheDocument();
    await waitFor(() => expect(useAuthStore.getState().bootstrapped).toBe(true));
    expect(mocks.refreshSession).not.toHaveBeenCalled();
  });

  it('restores the user before redirecting the root route to their home', async () => {
    mocks.getRefreshToken.mockReturnValue('refresh-token');
    mocks.refreshSession.mockResolvedValue('new-access-token');
    mocks.fetchMe.mockResolvedValue(worker);
    renderWithProviders(<App />, { route: '/' });
    expect(await screen.findByText('worker screen')).toBeInTheDocument();
    expect(useAuthStore.getState().user?.id).toBe('worker-id');
    expect(useAuthStore.getState().accessToken).toBe('new-access-token');
    expect(mocks.fetchMe).toHaveBeenCalledOnce();
  });

  it('falls back to login when refresh returns no access token', async () => {
    mocks.getRefreshToken.mockReturnValue('expired-refresh');
    mocks.refreshSession.mockResolvedValue(null);
    renderWithProviders(<App />, { route: '/' });
    expect(await screen.findByText('login screen')).toBeInTheDocument();
    await waitFor(() => expect(useAuthStore.getState().bootstrapped).toBe(true));
    expect(mocks.fetchMe).not.toHaveBeenCalled();
  });

  it('opens the cached read-only worker session when refresh is unavailable', async () => {
    useAuthStore.getState().setSession(worker, 'old-access', 'refresh-token');
    useAuthStore.setState({ user: null, role: null, accessToken: null, bootstrapped: false });
    mocks.getRefreshToken.mockReturnValue('refresh-token');
    mocks.refreshSession.mockResolvedValue(null);

    renderWithProviders(<App />, { route: '/' });

    expect(await screen.findByText('worker screen')).toBeInTheDocument();
    expect(useAuthStore.getState().user?.id).toBe('worker-id');
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('falls back to login when fetching the user fails after a successful refresh', async () => {
    mocks.getRefreshToken.mockReturnValue('refresh-token');
    mocks.refreshSession.mockResolvedValue('new-access-token');
    mocks.fetchMe.mockRejectedValue(new Error('server unavailable'));
    renderWithProviders(<App />, { route: '/' });
    expect(await screen.findByText('login screen')).toBeInTheDocument();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().bootstrapped).toBe(true);
  });

  it('redirects a worker from manager-only pages to the worker home', async () => {
    useAuthStore.getState().setSession(worker, 'access-token', 'refresh-token');
    useAuthStore.setState({ bootstrapped: true });
    renderWithProviders(<App />, { route: '/manager' });
    expect(await screen.findByText('worker screen')).toBeInTheDocument();
  });

  it('finishes bootstrap safely when refreshing the token rejects', async () => {
    mocks.getRefreshToken.mockReturnValue('refresh-token');
    mocks.refreshSession.mockRejectedValue(new Error('offline'));
    renderWithProviders(<App />, { route: '/' });
    expect(await screen.findByText('login screen')).toBeInTheDocument();
    expect(useAuthStore.getState().bootstrapped).toBe(true);
  });

  it('retains a cached read-only identity on a network failure fetching the profile', async () => {
    cacheWorker();
    mocks.refreshSession.mockResolvedValue('new-access');
    mocks.fetchMe.mockRejectedValue(new TypeError('network unavailable'));
    mocks.isNetworkFailure.mockReturnValue(true);
    renderWithProviders(<App />, { route: '/' });
    expect(await screen.findByText('worker screen')).toBeInTheDocument();
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('does not restore cached identity after an authorization failure', async () => {
    cacheWorker();
    mocks.refreshSession.mockResolvedValue('new-access');
    mocks.fetchMe.mockRejectedValue(new Error('403'));
    renderWithProviders(<App />, { route: '/' });
    expect(await screen.findByText('login screen')).toBeInTheDocument();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('recovers cached snapshots when profile loading exceeds four seconds', async () => {
    vi.useFakeTimers();
    cacheWorker();
    mocks.refreshSession.mockResolvedValue('new-access');
    mocks.fetchMe.mockReturnValue(pending<User>().promise);
    renderWithProviders(<App />, { route: '/' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4001);
    });
    expect(screen.getByText('worker screen')).toBeInTheDocument();
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not stay on the loading screen when token refresh never resolves', async () => {
    vi.useFakeTimers();
    cacheWorker();
    mocks.refreshSession.mockReturnValue(pending<string>().promise);
    renderWithProviders(<App />, { route: '/' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8001);
    });
    expect(screen.getByText('worker screen')).toBeInTheDocument();
    expect(useAuthStore.getState().bootstrapped).toBe(true);
    expect(mocks.fetchMe).not.toHaveBeenCalled();
  });

  it('shows a recoverable timeout banner if slow refresh and profile exceed boot guard', async () => {
    vi.useFakeTimers();
    cacheWorker();
    const refresh = pending<string>();
    mocks.refreshSession.mockReturnValue(refresh.promise);
    mocks.fetchMe.mockReturnValue(pending<User>().promise);
    renderWithProviders(<App />, { route: '/' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7000);
      refresh.resolve('new-access');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2001);
    });
    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.getByText('login screen')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(useAuthStore.getState().user?.id).toBe(worker.id);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });
});

describe('offline session reconnect', () => {
  beforeEach(() => {
    cacheWorker();
    useAuthStore.getState().restoreCachedSession();
    useAuthStore.setState({ bootstrapped: true });
  });

  async function reconnect() {
    renderWithProviders(<App />, { route: '/' });
    expect(await screen.findByText('worker screen')).toBeInTheDocument();
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
  }

  it('refreshes credentials and profile when connectivity returns', async () => {
    mocks.refreshSession.mockResolvedValue('online-access');
    mocks.fetchMe.mockResolvedValue(worker);
    await reconnect();
    expect(useAuthStore.getState().accessToken).toBe('online-access');
    expect(mocks.fetchMe).toHaveBeenCalledOnce();
  });

  it('accepts a legitimately rotated refresh credential on reconnect', async () => {
    mocks.refreshSession.mockImplementation(async () => {
      mocks.getRefreshToken.mockReturnValue('rotated-refresh');
      return 'online-access';
    });
    mocks.fetchMe.mockResolvedValue(worker);
    await reconnect();
    expect(useAuthStore.getState().accessToken).toBe('online-access');
  });

  it.each(['no-token', 'refresh-error', 'profile-error'])(
    'keeps read-only cache after %s',
    async (failure) => {
      if (failure === 'refresh-error') mocks.refreshSession.mockRejectedValue(new Error('offline'));
      else mocks.refreshSession.mockResolvedValue(failure === 'no-token' ? null : 'new-access');
      mocks.fetchMe.mockRejectedValue(new Error('still offline'));
      await reconnect();
      expect(useAuthStore.getState().user?.id).toBe(worker.id);
      expect(useAuthStore.getState().accessToken).toBeNull();
    },
  );

  it.each(['no-user', 'has-access', 'no-refresh'])(
    'skips unnecessary reconnect for %s',
    async (reason) => {
      if (reason === 'no-user') {
        useAuthStore.getState().logout();
        mocks.getRefreshToken.mockReturnValue(null);
      }
      if (reason === 'has-access') useAuthStore.getState().setAccessToken('existing-access');
      if (reason === 'no-refresh') mocks.getRefreshToken.mockReturnValue(null);
      renderWithProviders(<App />, { route: '/login' });
      await act(async () => {
        window.dispatchEvent(new Event('online'));
      });
      expect(mocks.refreshSession).not.toHaveBeenCalled();
    },
  );

  it('does not sign a user back in if they log out during reconnect', async () => {
    const profile = pending<User>();
    mocks.refreshSession.mockResolvedValue('late-access');
    mocks.fetchMe.mockReturnValue(profile.promise);
    await reconnect();
    await act(async () => {
      useAuthStore.getState().logout();
      profile.resolve(worker);
    });
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().accessToken).toBeNull();
  });
});
