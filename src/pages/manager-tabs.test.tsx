// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ManagerDashboard from './ManagerDashboard';
import { renderWithProviders } from '../test-utils';

const analyticsMock = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock('../api/misc', () => ({ analyticsGet: analyticsMock }));
vi.mock('../api/ai', () => ({ planOrderFromInsight: vi.fn(async () => ({})) }));
vi.mock('../hooks/useWS', () => ({
  useRealtime: () => ({ status: 'closed', reconnected: false }),
}));
vi.mock('../lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api-client')>();
  return {
    ...actual,
    api: { get: vi.fn(async () => ({ data: [] })), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  analyticsMock.mockImplementation(async (path: string) => {
    if (path === 'dashboard') return { kpis: {} };
    if (path === 'insights') return { items: [] };
    if (path === 'ratings') return [];
    if (path === 'areas') {
      return {
        items: [
          {
            id: 'row1',
            area_id: 'a1',
            employee_id: 'e1',
            name: 'Участок',
            score: 4.5,
            active: true,
            meta: { shift: 1 },
          },
        ],
      };
    }
    return { items: [] };
  });
});

describe('ManagerDashboard tabs', () => {
  it.each([
    ['Участки', 'areas'],
    ['Оборудование', 'equipment/ranking'],
    ['Материалы', 'materials'],
    ['Простои', 'downtime'],
    ['Качество', 'quality'],
  ])('tab %s loads %s', async (label, path) => {
    const u = userEvent.setup();
    renderWithProviders(<ManagerDashboard />);
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Обзор' })).toBeTruthy());
    await u.click(screen.getByRole('tab', { name: label }));
    await waitFor(() => expect(analyticsMock).toHaveBeenCalledWith(path, expect.anything()));
  });

  it('marks active tab selected', async () => {
    const u = userEvent.setup();
    renderWithProviders(<ManagerDashboard />);
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Обзор' })).toBeTruthy());
    await u.click(screen.getByRole('tab', { name: 'Материалы' }));
    expect(screen.getByRole('tab', { name: 'Материалы' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('ManagerDashboard section tables', () => {
  it('hides id columns except employee_id and caps at six', async () => {
    const u = userEvent.setup();
    renderWithProviders(<ManagerDashboard />);
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Обзор' })).toBeTruthy());
    await u.click(screen.getByRole('tab', { name: 'Участки' }));
    await waitFor(() => expect(screen.getByText('Участок')).toBeTruthy());
    // employee_id shown with translated header, raw ids hidden
    expect(screen.getByText('Сотрудник')).toBeTruthy();
    expect(screen.queryByText('a1')).toBeNull();
    expect(document.querySelectorAll('th')).toHaveLength(5);
  });

  it('formats booleans, numbers and objects', async () => {
    const u = userEvent.setup();
    renderWithProviders(<ManagerDashboard />);
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Обзор' })).toBeTruthy());
    await u.click(screen.getByRole('tab', { name: 'Участки' }));
    await waitFor(() => expect(screen.getByText('Участок')).toBeTruthy());
    expect(screen.getByText('Да')).toBeTruthy();
    expect(screen.getByText('4.5')).toBeTruthy();
    expect(screen.getByText('{"shift":1}')).toBeTruthy();
  });

  it('shows empty state for empty sections', async () => {
    const u = userEvent.setup();
    renderWithProviders(<ManagerDashboard />);
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Обзор' })).toBeTruthy());
    await u.click(screen.getByRole('tab', { name: 'Простои' }));
    await waitFor(() => expect(screen.getByText('Пока пусто')).toBeTruthy());
  });

  it('shows error with retry on section failure', async () => {
    const u = userEvent.setup();
    analyticsMock.mockImplementation(async (path: string) => {
      if (path === 'materials') throw new Error('down');
      if (path === 'dashboard') return { kpis: {} };
      if (path === 'insights') return { items: [] };
      if (path === 'ratings') return [];
      return { items: [] };
    });
    renderWithProviders(<ManagerDashboard />);
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Обзор' })).toBeTruthy());
    await u.click(screen.getByRole('tab', { name: 'Материалы' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });
});
