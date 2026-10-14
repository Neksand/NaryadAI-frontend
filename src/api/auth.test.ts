import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api-client')>();
  return { ...actual, api: apiMock };
});

import { fetchMe, login, logout, registerDevice } from './auth';

const user = { id: 'u1', login: 'admin', full_name: 'Админ', role: 'admin', area_ids: [] };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('login', () => {
  it('parses snake_case tokens with embedded user', async () => {
    apiMock.post.mockResolvedValueOnce({ data: { access_token: 'a', refresh_token: 'r', user } });
    const out = await login('admin', '1234');
    expect(apiMock.post).toHaveBeenCalledWith('/auth/login', { login: 'admin', pin: '1234' });
    expect(out).toMatchObject({ access: 'a', refresh: 'r', user: { id: 'u1' } });
  });

  it('parses camelCase tokens', async () => {
    apiMock.post.mockResolvedValueOnce({ data: { accessToken: 'a', refreshToken: 'r', user } });
    const out = await login('admin', '1234');
    expect(out.access).toBe('a');
    expect(out.refresh).toBe('r');
  });

  it('falls back to /me when user is missing', async () => {
    apiMock.post.mockResolvedValueOnce({ data: { access_token: 'a', refresh_token: null } });
    apiMock.get.mockResolvedValueOnce({ data: user });
    const out = await login('admin', '1234');
    expect(apiMock.get).toHaveBeenCalledWith('/me');
    expect(out.user.id).toBe('u1');
    expect(out.refresh).toBeNull();
  });

  it('normalizes login:null to empty string', async () => {
    apiMock.post.mockResolvedValueOnce({
      data: { access_token: 'a', refresh_token: 'r', user: { ...user, login: null } },
    });
    const out = await login('w', '1001');
    expect(out.user.login).toBe('');
  });
});

describe('fetchMe', () => {
  it('tries /me first', async () => {
    apiMock.get.mockResolvedValueOnce({ data: user });
    await expect(fetchMe()).resolves.toMatchObject({ id: 'u1' });
    expect(apiMock.get).toHaveBeenCalledWith('/me');
  });

  it('falls back to /auth/me with wrapped user', async () => {
    apiMock.get.mockRejectedValueOnce(new Error('404')).mockResolvedValueOnce({ data: { user } });
    await expect(fetchMe()).resolves.toMatchObject({ id: 'u1' });
    expect(apiMock.get).toHaveBeenCalledWith('/auth/me');
  });
});

describe('logout / registerDevice', () => {
  it('sends refresh token on logout', async () => {
    apiMock.post.mockResolvedValueOnce({ data: {} });
    await logout('r-token');
    expect(apiMock.post).toHaveBeenCalledWith('/auth/logout', { refresh_token: 'r-token' });
  });

  it('logout without token posts empty body', async () => {
    apiMock.post.mockResolvedValueOnce({ data: {} });
    await logout();
    expect(apiMock.post).toHaveBeenCalledWith('/auth/logout', {});
  });

  it('registers device with fcm token', async () => {
    apiMock.post.mockResolvedValueOnce({ data: {} });
    await registerDevice('android', 'fcm-1');
    expect(apiMock.post).toHaveBeenCalledWith('/devices', {
      platform: 'android',
      fcm_token: 'fcm-1',
    });
  });
});
