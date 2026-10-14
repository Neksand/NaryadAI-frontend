// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WorkerHome from './WorkerHome';
import { renderWithProviders } from '../test-utils';
import type { WorkOrder } from '../types/domain';

const queueState = vi.hoisted(() => ({
  queue: [] as unknown[],
  notices: [] as unknown[],
  online: true,
  replaying: false,
  lastReplayError: null as string | null,
}));
const replayMock = vi.hoisted(() => vi.fn(async () => ({ sent: 1, failed: 0 })));
const removeMock = vi.hoisted(() => vi.fn(async () => {}));
const dismissMock = vi.hoisted(() => vi.fn(async () => {}));
const soundMock = vi.hoisted(() => vi.fn(async () => {}));
const enqueueMock = vi.hoisted(() => vi.fn(async () => {}));
const transitionMock = vi.hoisted(() => vi.fn(async () => ({ status: 'accepted' })));

vi.mock('../api/workOrders', () => ({
  myWorkOrders: vi.fn(async (scope: string) => (scope === 'history' ? [] : [order()])),
  transitionOrder: transitionMock,
}));
vi.mock('../api/misc', () => ({
  listNotifications: vi.fn(async () => [{ id: 'n1' }, { id: 'n2' }]),
}));
vi.mock('../hooks/useOfflineQueue', () => ({
  useOfflineQueue: () => ({
    queue: queueState.queue,
    notices: queueState.notices,
    online: queueState.online,
    enqueue: enqueueMock,
    remove: removeMock,
    dismissNotice: dismissMock,
    replay: replayMock,
    replaying: queueState.replaying,
    lastReplayError: queueState.lastReplayError,
    count: queueState.queue.length,
  }),
}));
vi.mock('../lib/notifications', () => ({ playNewOrderSound: soundMock }));
vi.mock('../hooks/useWS', () => ({
  useRealtime: () => ({ status: 'closed', reconnected: false }),
}));
vi.mock('../lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api-client')>();
  return {
    ...actual,
    api: { get: vi.fn(async () => []), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

function order(): WorkOrder {
  return {
    id: 'o1',
    status: 'issued',
    priority: 'normal',
    description: 'Наряд',
    allowed_actions: ['accept'],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  queueState.queue = [];
  queueState.notices = [];
  queueState.online = true;
  queueState.replaying = false;
  queueState.lastReplayError = null;
});

describe('WorkerHome connectivity banners', () => {
  it('shows offline banner with queued count', async () => {
    queueState.online = false;
    queueState.queue = [{ key: 'k1' }, { key: 'k2' }];
    renderWithProviders(<WorkerHome />);
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(screen.getByText(/Нет связи/)).toBeTruthy();
    expect(screen.getByText('В очереди действий: 2')).toBeTruthy();
  });

  it('replays queue from banner button', async () => {
    const u = userEvent.setup();
    queueState.queue = [{ key: 'k1' }];
    renderWithProviders(<WorkerHome />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy());
    await u.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(replayMock).toHaveBeenCalledTimes(1);
  });

  it('shows last replay error', async () => {
    queueState.queue = [{ key: 'k1' }];
    queueState.lastReplayError = 'invalid_transition';
    renderWithProviders(<WorkerHome />);
    await waitFor(() => expect(screen.getByText('invalid_transition')).toBeTruthy());
  });

  it('shows unread badge on notifications tab', async () => {
    renderWithProviders(<WorkerHome />);
    const notifications = await screen.findByRole('link', { name: /Уведомления/ });
    await waitFor(() => expect(notifications.querySelector('.badge')?.textContent).toBe('2'));
  });

  it('shows individual queued actions with a delete control', async () => {
    queueState.queue = [
      {
        key: 'k1',
        orderId: 'order-12345678',
        action: 'accept',
        body: {},
        clientAt: new Date().toISOString(),
      },
    ];
    renderWithProviders(<WorkerHome />);
    await waitFor(() => expect(screen.getByText(/Принять в работу · №order-1/)).toBeTruthy());
    await userEvent.setup().click(screen.getByRole('button', { name: 'Удалить' }));
    expect(removeMock).toHaveBeenCalledWith('k1');
  });

  it('runs the next simple worker action directly from its prioritized card', async () => {
    const user = userEvent.setup();
    renderWithProviders(<WorkerHome />);
    await user.click(await screen.findByRole('button', { name: 'Принять в работу' }));
    await waitFor(() =>
      expect(transitionMock).toHaveBeenCalledWith('o1', 'accept', {}, expect.any(String)),
    );
  });

  it('queues the card next-step action with a stable key while offline', async () => {
    queueState.online = false;
    const user = userEvent.setup();
    renderWithProviders(<WorkerHome />);
    await user.click(await screen.findByRole('button', { name: 'Принять в работу' }));
    await waitFor(() =>
      expect(enqueueMock).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 'o1',
          action: 'accept',
          key: expect.any(String),
        }),
      ),
    );
    expect(transitionMock).not.toHaveBeenCalled();
  });

  it('keeps a localized explanation after dropping a conflicting action', async () => {
    queueState.notices = [
      {
        key: 'conflict-1',
        orderId: 'order-12345678',
        action: 'accept',
        code: 'invalid_transition',
        message: 'invalid_transition',
        status: 409,
        occurredAt: new Date().toISOString(),
      },
    ];
    renderWithProviders(<WorkerHome />);
    expect(
      await screen.findByText(/Действие не отправлено: состояние наряда изменилось/),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Обновить' }).getAttribute('href')).toBe(
      '/worker/orders/order-12345678',
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(dismissMock).toHaveBeenCalledWith('conflict-1');
  });

  it('announces a new order in the page and plays an alert sound', async () => {
    renderWithProviders(<WorkerHome />);
    window.dispatchEvent(
      new CustomEvent('naryadai:work-order-created', { detail: { id: 'new-1', number: 91 } }),
    );
    expect(await screen.findByText('Новый наряд №91')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Открыть наряд' }).getAttribute('href')).toBe(
      '/worker/orders/new-1',
    );
    expect(soundMock).toHaveBeenCalledTimes(1);
  });
});
