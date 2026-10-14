// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useRealtime } from './useWS';
import { useAuthStore } from '../store/auth-store';
import '../i18n/config';

class FakeWS {
  static instances: FakeWS[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((msg: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.onclose?.();
  });
  constructor(url: string) {
    this.url = url;
    FakeWS.instances.push(this);
  }
}

vi.stubGlobal('WebSocket', FakeWS);

vi.mock('../lib/env', () => ({
  API_URL: 'http://test.local/api/v1',
  WS_URL: 'ws://test.local/api/ws',
  isLoopbackApi: (url: string) =>
    url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1'),
  wsUrlWithToken: (token: string) => `ws://test.local/api/ws?token=${token}`,
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const user = { id: 'u1', login: 'w', full_name: 'Работник', role: 'worker', area_ids: [] } as const;

beforeEach(() => {
  FakeWS.instances.length = 0;
  vi.useFakeTimers();
  useAuthStore.getState().logout();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function connect() {
  useAuthStore.getState().setSession({ ...user }, 'tok', 'ref');
  const hook = renderHook(() => useRealtime(true), { wrapper });
  const ws = FakeWS.instances[FakeWS.instances.length - 1];
  act(() => {
    ws.onopen?.();
  });
  return { hook, ws };
}

describe('useRealtime', () => {
  it('does nothing without token', () => {
    renderHook(() => useRealtime(true), { wrapper });
    expect(FakeWS.instances).toHaveLength(0);
  });

  it('subscribes to shift and user channels on open', () => {
    useAuthStore.getState().setSession({ ...user }, 'tok', 'ref');
    renderHook(() => useRealtime(true), { wrapper });
    const ws = FakeWS.instances[0];
    expect(ws.url).toContain('token=tok');
    act(() => {
      ws.onopen?.();
    });
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ op: 'subscribe', channels: ['shift:current', 'user:me'] }),
    );
  });

  it('invalidates screens on work order events with order id', () => {
    const spy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    const newOrder = vi.fn();
    window.addEventListener('naryadai:work-order-created', newOrder);
    const { ws } = connect();
    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({ event: 'WORK_ORDER_CREATED', payload: { id: 'o9', number: 21 } }),
      });
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['orders'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['board'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['notifications'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['order', 'o9'] });
    expect(newOrder.mock.calls[0][0].detail).toEqual({ id: 'o9', number: 21 });
    window.removeEventListener('naryadai:work-order-created', newOrder);
  });

  it('ignores unrelated events, acks and garbage', () => {
    const spy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    const { ws } = connect();
    spy.mockClear();
    act(() => {
      ws.onmessage?.({ data: JSON.stringify({ type: 'SUBSCRIBED' }) });
      ws.onmessage?.({ data: JSON.stringify({ event: 'something.else' }) });
      ws.onmessage?.({ data: 'not-json{{{' });
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('reloads everything on sequence gap', () => {
    const spy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    const { ws } = connect();
    spy.mockClear();
    act(() => {
      ws.onmessage?.({ data: JSON.stringify({ event: 'WORK_ORDER_UPDATED', seq: 5 }) });
    });
    expect(spy).not.toHaveBeenCalledWith(undefined);
    act(() => {
      ws.onmessage?.({ data: JSON.stringify({ event: 'WORK_ORDER_UPDATED', seq: 7 }) });
    });
    expect(spy).toHaveBeenCalledWith();
  });

  it('reconnects with backoff and shows banner briefly', () => {
    const { hook } = connect();
    expect(hook.result.current.status).toBe('open');
    act(() => {
      FakeWS.instances[0].onclose?.();
    });
    expect(hook.result.current.status).toBe('closed');
    expect(FakeWS.instances).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(FakeWS.instances).toHaveLength(2);
    act(() => {
      FakeWS.instances[1].onopen?.();
    });
    expect(hook.result.current.reconnected).toBe(true);
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(hook.result.current.reconnected).toBe(false);
  });

  it('closes socket on unmount', () => {
    const { hook } = connect();
    const ws = FakeWS.instances[0];
    hook.unmount();
    expect(ws.close).toHaveBeenCalled();
  });
});
