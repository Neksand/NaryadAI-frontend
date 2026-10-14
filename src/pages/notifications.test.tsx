// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotificationsPage from './Notifications';
import { renderWithProviders } from '../test-utils';

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
});
