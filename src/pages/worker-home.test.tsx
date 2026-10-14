// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WorkerHome from './WorkerHome';
import { renderWithProviders } from '../test-utils';
import type { WorkOrder } from '../types/domain';

const myWorkOrdersMock = vi.hoisted(() => vi.fn());
const listNotificationsMock = vi.hoisted(() => vi.fn(async () => []));

vi.mock('../api/workOrders', () => ({ myWorkOrders: myWorkOrdersMock }));
vi.mock('../api/misc', () => ({ listNotifications: listNotificationsMock }));
vi.mock('../hooks/useOfflineQueue', () => ({
  useOfflineQueue: () => ({
    queue: [],
    online: true,
    enqueue: vi.fn(),
    remove: vi.fn(),
    replay: vi.fn(),
    replaying: false,
    lastReplayError: null,
    count: 0,
  }),
}));
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

const mk = (over: Partial<WorkOrder> & { id: string }): WorkOrder => ({
  status: 'issued',
  priority: 'normal',
  description: `Наряд ${over.id}`,
  allowed_actions: [],
  ...over,
});

const active = [
  mk({ id: 'crit1', status: 'in_progress', priority: 'critical', description: 'Авария насоса' }),
  mk({
    id: 'late1',
    status: 'accepted',
    priority: 'normal',
    description: 'Просрочка',
    is_overdue: true,
  }),
  mk({ id: 'plain1', status: 'accepted', priority: 'normal', description: 'Плановый осмотр' }),
  mk({ id: 'queue1', status: 'queued', priority: 'normal', description: 'Ждёт очереди' }),
];
const history = Array.from({ length: 12 }, (_, i) =>
  mk({ id: `h${i}`, status: 'closed', priority: 'normal', description: `История ${i}` }),
);

beforeEach(() => {
  vi.clearAllMocks();
  myWorkOrdersMock.mockImplementation(async (scope: string) =>
    scope === 'history' ? history : active,
  );
});

describe('WorkerHome', () => {
  it('does not duplicate urgent orders in the list', async () => {
    renderWithProviders(<WorkerHome />);
    await waitFor(() => expect(screen.getByText('Авария насоса')).toBeTruthy());
    expect(screen.getAllByText('Авария насоса')).toHaveLength(1);
    expect(screen.getAllByText('Просрочка')).toHaveLength(1);
  });

  it('filters urgent and queue', async () => {
    const u = userEvent.setup();
    renderWithProviders(<WorkerHome />);
    await waitFor(() => expect(screen.getByText('Плановый осмотр')).toBeTruthy());
    await u.click(screen.getByRole('tab', { name: /Срочные/ }));
    expect(screen.queryByText('Плановый осмотр')).toBeNull();
    expect(screen.getByText('Авария насоса')).toBeTruthy();
    await u.click(screen.getByRole('tab', { name: /Очередь/ }));
    expect(screen.getByText('Ждёт очереди')).toBeTruthy();
    expect(screen.queryByText('Авария насоса')).toBeNull();
  });

  it('shows error with retry when active fails', async () => {
    myWorkOrdersMock.mockImplementation(async (scope: string) => {
      if (scope === 'history') return [];
      throw new Error('down');
    });
    renderWithProviders(<WorkerHome />);
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    myWorkOrdersMock.mockImplementation(async (scope: string) =>
      scope === 'history' ? [] : active,
    );
    await userEvent.setup().click(screen.getAllByText('Повторить')[0]);
    await waitFor(() => expect(screen.getByText('Авария насоса')).toBeTruthy());
  });

  it('paginates history with more button', async () => {
    const u = userEvent.setup();
    renderWithProviders(<WorkerHome />);
    await waitFor(() => expect(screen.getByText('История 0')).toBeTruthy());
    expect(screen.queryByText('История 10')).toBeNull();
    await u.click(screen.getByRole('button', { name: /Показать ещё \(2\)/ }));
    expect(screen.getByText('История 10')).toBeTruthy();
    expect(screen.getByText('История 11')).toBeTruthy();
  });
});
