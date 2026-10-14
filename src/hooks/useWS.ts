import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { wsUrlWithToken } from '../lib/env';
import { useAuthStore } from '../store/auth-store';

export interface WsEvent {
  event: string;
  channels?: string[];
  payload?: Record<string, unknown>;
  seq?: number;
  at?: string;
}

const BACKOFF = [1000, 2000, 4000, 8000, 15000];

/** Real WebSocket: /api/ws?token=, subscribe [shift:current, user:me], seq-gap refetch, reconnect banner. */
export function useRealtime(enabled = true) {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('closed');
  const [reconnected, setReconnected] = useState(false);
  const lastSeq = useRef<number>(0);
  const attempt = useRef(0);

  useEffect(() => {
    if (!enabled || !token) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let timer: ReturnType<typeof setTimeout>;
    let hideTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      setStatus('connecting');
      ws = new WebSocket(wsUrlWithToken(token));
      ws.onopen = () => {
        setStatus('open');
        // Баннер «связь восстановлена» — только после реального разрыва, прячем через 6с.
        if (attempt.current > 0) {
          setReconnected(true);
          clearTimeout(hideTimer);
          hideTimer = setTimeout(() => setReconnected(false), 6000);
        }
        attempt.current = 0;
        ws?.send(JSON.stringify({ op: 'subscribe', channels: ['shift:current', 'user:me'] }));
      };
      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data as string) as WsEvent & {
            type?: string;
            channels?: string[];
          };
          if (
            data.type === 'SUBSCRIBED' ||
            (data as unknown as { event?: string }).event === 'subscribed'
          )
            return;
          // Живая доставка идёт конвертом {"type", "timestamp", "payload"} (realtime.broadcast),
          // outbox-путь — {"event", "channels", "payload", "seq"}. Принимаем оба.
          const ev = (data.event ?? data.type ?? '') as string;
          if (typeof data.seq === 'number') {
            if (lastSeq.current && data.seq > lastSeq.current + 1) {
              // seq gap — reload current screens instead of trusting the stream
              void qc.invalidateQueries();
            }
            lastSeq.current = data.seq;
          }
          if (!ev) return;
          if (ev === 'WORK_ORDER_CREATED' || ev === 'order.created') {
            const payload = data.payload as { id?: string; number?: number } | undefined;
            if (payload?.id) {
              window.dispatchEvent(
                new CustomEvent('naryadai:work-order-created', { detail: payload }),
              );
            }
          }
          if (
            ev.startsWith('order.') ||
            ev.startsWith('WORK_ORDER') ||
            ev === 'counters.updated' ||
            ev === 'employee.status_changed' ||
            ev === 'insight.created' ||
            ev === 'NOTIFICATION_CREATED' ||
            ev.includes('ai_review') ||
            ev.includes('AI_') ||
            ev.includes('DEADLINE')
          ) {
            void qc.invalidateQueries({ queryKey: ['orders'] });
            void qc.invalidateQueries({ queryKey: ['board'] });
            void qc.invalidateQueries({ queryKey: ['notifications'] });
            const p = data.payload as
              { id?: string; work_order_id?: string; order_id?: string } | undefined;
            const orderId = p?.id ?? p?.work_order_id ?? p?.order_id;
            if (orderId) void qc.invalidateQueries({ queryKey: ['order', orderId] });
          }
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = (event) => {
        if (closed) return;
        setStatus('closed');
        setReconnected(false);
        // 4401 is an auth rejection from the API. Reconnecting with the same
        // invalid token only creates an endless connection loop; return to login.
        if (event?.code === 4401) {
          useAuthStore.getState().logout();
          return;
        }
        const delay = BACKOFF[Math.min(attempt.current, BACKOFF.length - 1)] ?? 15000;
        attempt.current += 1;
        timer = setTimeout(() => {
          connect();
        }, delay);
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      clearTimeout(hideTimer);
      ws?.close();
    };
  }, [enabled, token, qc]);

  return { status, reconnected };
}
