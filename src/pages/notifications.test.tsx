// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotificationsPage, {
  formatNotifRelative,
  notificationOrderId,
  notificationOrderLink,
} from './Notifications';
import { renderWithProviders } from '../test-utils';
import { useAuthStore } from '../store/auth-store';
import ru from '../i18n/ru';
import kk from '../i18n/kk';

const listMock = vi.hoisted(() => vi.fn());
const readMock = vi.hoisted(() => vi.fn(async () => {}));
const readAllMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('../api/misc', () => ({
  listNotifications: listMock,
  markRead: readMock,
  markAllRead: readAllMock,
}));
vi.mock('../hooks/useWS', () => ({
  useRealtime: () => ({ status: 'closed', reconnected: false }),
}));

const items = [
  {
    id: 'n1',
    type: 'WORK_ORDER_ASSIGNED',
    title: 'Назначен наряд',
    body: 'Насос',
    is_read: false,
    created_at: '2026-10-12T09:05:00',
  },
  {
    id: 'n2',
    type: 'WORK_ORDER_CLOSED',
    title: 'Закрыт',
    is_read: true,
    created_at: '2026-10-11T09:05:00',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue(items);
});

afterEach(() => {
  useAuthStore.getState().logout();
});

describe('NotificationsPage', () => {
  it('renders notifications with translated types', async () => {
    renderWithProviders(<NotificationsPage />);
    await waitFor(() => expect(screen.getByText('Назначен наряд')).toBeTruthy());
    expect(screen.getByText('Наряд назначен')).toBeTruthy();
    expect(screen.getByText('Насос')).toBeTruthy();
  });

  it('clicking unread marks it read', async () => {
    const u = userEvent.setup();
    renderWithProviders(<NotificationsPage />);
    await waitFor(() => expect(screen.getByText('Назначен наряд')).toBeTruthy());
    await u.click(screen.getByText('Назначен наряд'));
    await waitFor(() => expect(readMock).toHaveBeenCalledWith('n1'));
  });

  it('read-all button marks everything', async () => {
    const u = userEvent.setup();
    renderWithProviders(<NotificationsPage />);
    await waitFor(() => expect(screen.getByText('Назначен наряд')).toBeTruthy());
    await u.click(screen.getByRole('button', { name: /Прочитать все/ }));
    await waitFor(() => expect(readAllMock).toHaveBeenCalledTimes(1));
  });

  it('shows empty state', async () => {
    listMock.mockResolvedValueOnce([]);
    renderWithProviders(<NotificationsPage />);
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
  });

  it('shows skeleton while loading', async () => {
    listMock.mockReturnValueOnce(new Promise(() => {}));
    const { container } = renderWithProviders(<NotificationsPage />);
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeTruthy());
  });

  it('renders labels for every backend type without raw codes', async () => {
    const typed = [
      'WORK_ORDER_ASSIGNED',
      'WORK_ORDER_ACCEPTED',
      'WORK_ORDER_REJECTED',
      'WORK_ORDER_STARTED',
      'WORK_ORDER_PAUSED',
      'WORK_ORDER_RESUMED',
      'WORK_ORDER_COMPLETED',
      'WORK_ORDER_CLOSED',
      'WORK_ORDER_REWORK',
      'WORK_ORDER_UPDATED',
      'WORK_ORDER_CREATED',
      'AI_INSPECTION_READY',
      'DEADLINE_WARNING',
      'DEADLINE_EXCEEDED',
      'DEADLINE_30MIN',
      'LONG_OVERDUE_120MIN',
      'NOT_ACCEPTED_WITH_CANDIDATE',
      'WORKER_STATUS_CHANGED',
    ].map((type, i) => ({ id: `t${i}`, type, is_read: true }));
    listMock.mockResolvedValueOnce(typed);
    renderWithProviders(<NotificationsPage />);
    for (const type of typed) {
      const expected = (ru.notif as Record<string, string>)[type.type];
      expect(expected, `ru key for ${type.type}`).toBeTruthy();
      await waitFor(() => expect(screen.getAllByText(expected).length).toBeGreaterThan(0));
      expect(screen.queryByText(type.type)).toBeNull();
    }
  });

  it('unknown type falls back to the raw code', async () => {
    listMock.mockResolvedValueOnce([{ id: 'nx', type: 'SOME_FUTURE_TYPE_XYZ', is_read: true }]);
    renderWithProviders(<NotificationsPage />);
    await waitFor(() =>
      expect(screen.getAllByText('SOME_FUTURE_TYPE_XYZ').length).toBeGreaterThan(0),
    );
  });

  it('row with a related order links to the order page and marks read', async () => {
    useAuthStore.setState({
      user: { id: 'u1', full_name: 'Worker', role: 'worker', area_ids: [] },
      role: 'worker',
    });
    listMock.mockResolvedValueOnce([
      {
        id: 'n9',
        type: 'WORK_ORDER_ASSIGNED',
        title: 'Назначен наряд',
        is_read: false,
        created_at: '2026-10-12T09:05:00',
        data: { work_order_id: 'o123' },
      },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<NotificationsPage />);
    const link = await screen.findByRole('link', { name: /Открыть наряд/ });
    expect(link).toHaveAttribute('href', '/worker/orders/o123');
    await u.click(link);
    await waitFor(() => expect(readMock).toHaveBeenCalledWith('n9'));
  });

  it('read-all button meets the 44px tap target', async () => {
    renderWithProviders(<NotificationsPage />);
    const btn = await screen.findByRole('button', { name: /Прочитать все/ });
    expect(btn.className).toMatch(/min-h-11/);
  });
});

describe('formatNotifRelative', () => {
  const now = new Date('2026-10-16T12:00:00').getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it.each([
    [30_000, 'только что'],
    [5 * 60_000, '5 мин назад'],
    [60 * 60_000, '1 ч назад'],
    [3 * 60 * 60_000, '3 ч назад'],
    [25 * 60 * 60_000, '1 дн назад'],
    [3 * 24 * 60 * 60_000, '3 дн назад'],
  ])('ru: %dms ago → %s', (ms, expected) => {
    expect(formatNotifRelative(ago(ms as number), { now })).toBe(expected);
  });

  it.each([
    [30_000, 'қазір'],
    [5 * 60_000, '5 мин бұрын'],
    [2 * 60 * 60_000, '2 сағ бұрын'],
    [2 * 24 * 60 * 60_000, '2 күн бұрын'],
  ])('kk: %dms ago → %s', (ms, expected) => {
    expect(formatNotifRelative(ago(ms as number), { now, lang: 'kk' })).toBe(expected);
  });

  it('falls back to absolute date for old or bad input', () => {
    expect(formatNotifRelative(ago(10 * 24 * 60 * 60_000), { now })).toBe('');
    expect(formatNotifRelative(null, { now })).toBe('');
    expect(formatNotifRelative('not-a-date', { now })).toBe('');
    expect(formatNotifRelative(undefined, { now })).toBe('');
  });
});

describe('notificationOrderId / notificationOrderLink', () => {
  it('reads the order id from data payload variants', () => {
    expect(
      notificationOrderId({ id: 'n', type: 'WORK_ORDER_ASSIGNED', data: { work_order_id: 'o1' } }),
    ).toBe('o1');
    expect(
      notificationOrderId({ id: 'n', type: 'DEADLINE_WARNING', data: { related_entity_id: 'o2' } }),
    ).toBe('o2');
    expect(
      notificationOrderId({ id: 'n', type: 'WORK_ORDER_UPDATED', order_id: 'o3' } as never),
    ).toBe('o3');
  });

  it('never mistakes the notification id for the order id', () => {
    expect(notificationOrderId({ id: 'n1', type: 'WORK_ORDER_ASSIGNED' })).toBeNull();
    expect(notificationOrderId({ id: 'n1', type: 'WORK_ORDER_ASSIGNED', data: {} })).toBeNull();
  });

  it('links order-bound types to role routes, skips the rest', () => {
    const withOrder = (type: string) => ({
      id: 'n',
      type,
      data: { work_order_id: 'o7' },
    });
    expect(notificationOrderLink(withOrder('WORK_ORDER_ASSIGNED'), 'worker')).toBe(
      '/worker/orders/o7',
    );
    expect(notificationOrderLink(withOrder('DEADLINE_30MIN'), 'master')).toBe('/master/orders/o7');
    expect(notificationOrderLink(withOrder('LONG_OVERDUE_120MIN'), 'admin')).toBe(
      '/master/orders/o7',
    );
    expect(notificationOrderLink(withOrder('WORK_ORDER_ASSIGNED'), 'manager')).toBeNull();
    expect(notificationOrderLink(withOrder('WORK_ORDER_ASSIGNED'), null)).toBeNull();
    // WORKER_STATUS_CHANGED несёт id сотрудника — ссылкой не становится.
    expect(
      notificationOrderLink(
        { id: 'n', type: 'WORKER_STATUS_CHANGED', data: { id: 'emp1' } },
        'worker',
      ),
    ).toBeNull();
    expect(notificationOrderLink({ id: 'n', type: 'WORK_ORDER_ASSIGNED' }, 'worker')).toBeNull();
  });
});

describe('notif i18n parity', () => {
  it('ru and kk expose the same notif keys', () => {
    const ruKeys = Object.keys(ru.notif).sort();
    const kkKeys = Object.keys(kk.notif).sort();
    expect(kkKeys).toEqual(ruKeys);
    for (const key of [
      'DEADLINE_30MIN',
      'LONG_OVERDUE_120MIN',
      'NOT_ACCEPTED_WITH_CANDIDATE',
      'empty',
      'openOrder',
    ]) {
      expect(ruKeys).toContain(key);
      expect((kk.notif as Record<string, string>)[key]?.length).toBeGreaterThan(0);
    }
  });
});
