import { describe, expect, it } from 'vitest';
import { AxiosError } from 'axios';
import { friendlyLoginError } from './Login';
import '../i18n/config';

const t = (key: string) => {
  const map: Record<string, string> = {
    'auth.errTimeout': 'TIMEOUT',
    'auth.errOffline': 'OFFLINE',
    'auth.errBadCreds': 'BADCRED',
    'auth.errLocked': 'LOCKED',
    'auth.errFallback': 'FALLBACK',
  };
  return map[key] ?? key;
};

describe('friendlyLoginError', () => {
  it('maps timeout without response', () => {
    const e = new AxiosError('timeout of 20000ms exceeded', 'ECONNABORTED');
    expect(friendlyLoginError(e, t)).toBe('TIMEOUT');
  });

  it('maps timeout by message text', () => {
    const e = new AxiosError('Request Timeout');
    expect(friendlyLoginError(e, t)).toBe('TIMEOUT');
  });

  it('maps offline without response', () => {
    expect(friendlyLoginError(new AxiosError('Network Error'), t)).toBe('OFFLINE');
  });

  it('maps 401 to bad credentials', () => {
    const e = new AxiosError('x', undefined, undefined, undefined, {
      status: 401,
      data: { error: { code: 'unauthorized', message: 'no' } },
    } as never);
    expect(friendlyLoginError(e, t)).toBe('BADCRED');
  });

  it('maps 423 to locked', () => {
    const e = new AxiosError('x', undefined, undefined, undefined, {
      status: 423,
      data: { error: { code: 'account_locked', message: 'locked' } },
    } as never);
    expect(friendlyLoginError(e, t)).toBe('LOCKED');
  });

  it('falls back to server message', () => {
    const e = new AxiosError('x', undefined, undefined, undefined, {
      status: 500,
      data: { detail: 'DB down' },
    } as never);
    expect(friendlyLoginError(e, t)).toBe('DB down');
  });
});
