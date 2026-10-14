// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MasterShift from './MasterShift';
import { renderWithProviders } from '../test-utils';
import type { WorkOrder } from '../types/domain';

const shiftBoardMock = vi.hoisted(() => vi.fn());
const listWorkOrdersMock = vi.hoisted(() => vi.fn());

vi.mock('../api/workOrders', () => ({
  shiftBoard: shiftBoardMock,
  listWorkOrders: listWorkOrdersMock,
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

const order = (id: string): WorkOrder => ({
  id,
  status: 'issued',
  priority: 'normal',
  description: `Наряд ${id}`,
  allowed_actions: [],
});

const employees = Array.from({ length: 13 }, (_, i) => ({
  id: `e${i}`,
  name: `Сотрудник ${i}`,
  status: 'free',
  queue_count: i,
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  shiftBoardMock.mockResolvedValue({
    counters: { issued: 5, done: 3, overdue: 2, equipment_down: 1 },
    employees,
  });
  listWorkOrdersMock.mockImplementation(async (f: { overdue?: boolean }) =>
    f?.overdue
      ? { items: [order('late')], next_cursor: null }
      : { items: [order('a1')], next_cursor: null },
  );
});

describe('MasterShift', () => {
  it('renders KPI counters', async () => {
    renderWithProviders(<MasterShift />);
    await waitFor(() => expect(screen.getByText('5')).toBeTruthy());
    expect(screen.getByText('Выдано')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('marks overdue KPI as danger', async () => {
    renderWithProviders(<MasterShift />);
    await waitFor(() => expect(document.querySelector('.kpi.danger')).toBeTruthy());
    expect(screen.getAllByText('Просрочено').length).toBeGreaterThanOrEqual(1);
  });

  it('keeps create button in sticky dock', async () => {
    renderWithProviders(<MasterShift />);
    const link = await screen.findByRole('link', { name: /Новый наряд/ });
    expect(link.getAttribute('href')).toBe('/master/new');
    expect(link.closest('.dock-sticky')).toBeTruthy();
  });

  it('refresh refetches all queries', async () => {
    const u = userEvent.setup();
    renderWithProviders(<MasterShift />);
    await waitFor(() => expect(shiftBoardMock).toHaveBeenCalledTimes(1));
    await u.click(screen.getByRole('button', { name: 'Обновить' }));
    await waitFor(() => expect(shiftBoardMock).toHaveBeenCalledTimes(2));
    expect(listWorkOrdersMock.mock.calls.length).toBeGreaterThan(2);
  });

  it('paginates team list', async () => {
    const u = userEvent.setup();
    renderWithProviders(<MasterShift />);
    await waitFor(() => expect(screen.getByText('Сотрудник 0')).toBeTruthy());
    expect(screen.queryByText('Сотрудник 12')).toBeNull();
    await u.click(screen.getByRole('button', { name: /Показать ещё \(1\)/ }));
    expect(screen.getByText('Сотрудник 12')).toBeTruthy();
  });
});
