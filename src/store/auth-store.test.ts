import { beforeEach, describe, expect, it } from 'vitest';
import { readCachedUser, roleHome, useAuthStore } from './auth-store';
import type { User } from '../types/domain';

const mkUser = (role: User['role'], id = `id-${role}`): User => ({
  id,
  login: role,
  full_name: `Демо ${role}`,
  role,
  area_ids: [],
});

beforeEach(() => {
  useAuthStore.getState().logout();
  useAuthStore.setState({ bootstrapped: false });
});

describe('auth-store session', () => {
  it('sets user, role and token', () => {
    useAuthStore.getState().setSession(mkUser('worker'), 'a', 'r');
    const s = useAuthStore.getState();
    expect(s.user?.role).toBe('worker');
    expect(s.role).toBe('worker');
    expect(s.accessToken).toBe('a');
  });

  it('logout clears everything', () => {
    useAuthStore.getState().setSession(mkUser('admin'), 'a', 'r');
    useAuthStore.getState().logout();
    const s = useAuthStore.getState();
    expect(s.user).toBeNull();
    expect(s.role).toBeNull();
    expect(s.accessToken).toBeNull();
    expect(readCachedUser()).toBeNull();
  });

  it('restores a cached profile without restoring an access token', () => {
    const user = mkUser('worker');
    useAuthStore.getState().setSession(user, 'secret-access', 'refresh');
    useAuthStore.setState({ user: null, role: null, accessToken: null });

    expect(useAuthStore.getState().restoreCachedSession()).toBe(true);
    expect(useAuthStore.getState().user?.id).toBe(user.id);
    expect(useAuthStore.getState().role).toBe('worker');
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(readCachedUser()?.id).toBe(user.id);
  });

  it('ignores a malformed cached profile', () => {
    localStorage.setItem('naryadai.cached-user.v1', '{broken');
    expect(useAuthStore.getState().restoreCachedSession()).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('setAccessToken updates token only', () => {
    useAuthStore.getState().setSession(mkUser('master'), 'a1', 'r');
    useAuthStore.getState().setAccessToken('a2');
    expect(useAuthStore.getState().accessToken).toBe('a2');
    expect(useAuthStore.getState().user?.role).toBe('master');
  });

  it('setBootstrapped flips once', () => {
    expect(useAuthStore.getState().bootstrapped).toBe(false);
    useAuthStore.getState().setBootstrapped();
    expect(useAuthStore.getState().bootstrapped).toBe(true);
  });
});

describe('roleHome', () => {
  it.each([
    ['worker', '/worker'],
    ['master', '/master'],
    ['manager', '/manager'],
    ['admin', '/admin'],
  ] as const)('routes %s to %s', (role, home) => {
    expect(roleHome(role)).toBe(home);
  });
  it('falls back to /login', () => {
    expect(roleHome(null)).toBe('/login');
  });
});
