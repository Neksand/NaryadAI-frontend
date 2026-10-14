// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from './test-utils';
import App from './App';
import { useAuthStore } from './store/auth-store';
import type { User } from './types/domain';

const mocks = vi.hoisted(() => ({
  getRefreshToken: vi.fn(),
  refreshSession: vi.fn(),
  fetchMe: vi.fn(),
}));
vi.mock('./lib/api-client', () => ({
  setTokens: vi.fn(),
  getRefreshToken: mocks.getRefreshToken,
  refreshSession: mocks.refreshSession,
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
  mocks.getRefreshToken.mockReturnValue(null);
  mocks.refreshSession.mockReset();
  mocks.fetchMe.mockReset();
  useAuthStore.getState().logout();
  useAuthStore.setState({ bootstrapped: false });
});

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
});
