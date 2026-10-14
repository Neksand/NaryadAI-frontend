import { describe, expect, it } from 'vitest';
import { isLoopbackApi, websocketUrlWithToken } from './env';

describe('local API detection', () => {
  it.each([
    'http://localhost:8080/api/v1',
    'http://127.0.0.1:8080/api/v1',
    'http://[::1]:8080/api/v1',
  ])('allows local demo access for %s', (url) => {
    expect(isLoopbackApi(url)).toBe(true);
  });

  it.each([
    'https://api.naryad-ai.kz/api/v1',
    'http://192.168.1.20:8080/api/v1',
    '/api/v1',
    'not a url',
  ])('does not treat remote or invalid URL %s as local', (url) => {
    expect(isLoopbackApi(url)).toBe(false);
  });
});

describe('websocketUrlWithToken', () => {
  it('uses secure WSS on an HTTPS same-origin deployment and safely encodes token', () => {
    const result = websocketUrlWithToken(
      '/api/ws?room=current',
      'a+b/c',
      'https://app.example/orders',
    );
    const url = new URL(result);
    expect(url.protocol).toBe('wss:');
    expect(url.host).toBe('app.example');
    expect(url.pathname).toBe('/api/ws');
    expect(url.searchParams.get('room')).toBe('current');
    expect(url.searchParams.get('token')).toBe('a+b/c');
  });

  it('keeps an explicit secure websocket endpoint and replaces an old token', () => {
    const result = websocketUrlWithToken(
      'wss://api.example/ws?token=stale',
      'fresh',
      'https://app.example/',
    );
    const url = new URL(result);
    expect(url.protocol).toBe('wss:');
    expect(url.searchParams.getAll('token')).toEqual(['fresh']);
  });

  it('upgrades an explicit HTTP endpoint to WS without changing its host', () => {
    expect(websocketUrlWithToken('http://127.0.0.1:8080/api/ws', 't', 'tauri://localhost/')).toBe(
      'ws://127.0.0.1:8080/api/ws?token=t',
    );
  });

  it('rejects unsupported app protocols instead of opening a malformed socket', () => {
    expect(() => websocketUrlWithToken('/api/ws', 't', 'tauri://localhost/index.html')).toThrow(
      'Unsupported WebSocket protocol',
    );
  });
});
