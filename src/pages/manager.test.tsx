// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ManagerDashboard from './ManagerDashboard';
import { renderWithProviders } from '../test-utils';

const analyticsMock = vi.hoisted(() => vi.fn());
const planMock = vi.hoisted(() => vi.fn(async () => ({ id: 'n1' })));
const workersGetMock = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => ({ data: [{ id: 'w1', full_name: 'Иван' }] })),
);

vi.mock('../api/misc', () => ({ analyticsGet: analyticsMock }));
vi.mock('../api/ai', () => ({ planOrderFromInsight: planMock }));
vi.mock('../hooks/useWS', () => ({
  useRealtime: () => ({ status: 'closed', reconnected: false }),
}));
vi.mock('../lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api-client')>();
  return {
    ...actual,
    api: { get: workersGetMock, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const insights = [
  {
    id: 'i1',
    headline: 'Простои насоса',
    severity: 'critical',
    confidence: 0.8,
    explanation: 'Проверить уплотнение',
  },
  {
    id: 'i2',
    headline: 'Перерасход масла',
    severity: 'warning',
    confidence: 0.6,
    explanation: 'Сменить норму',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  analyticsMock.mockImplementation(async (path: string) => {
    if (path === 'dashboard') return { kpis: { closed: 10, total: 20 } };
    if (path === 'trends') return { data: [{ day: '2026-10-13', created: 3, closed: 2 }] };
    if (path === 'insights') return { items: insights };
    if (path === 'ratings') return [];
    return {};
  });
});

describe('ManagerDashboard insights', () => {
  it('fetches workers once for all insight cards (no N+1)', async () => {
    renderWithProviders(<ManagerDashboard />);
    await waitFor(() => expect(screen.getByText('Простои насоса')).toBeTruthy());
    expect(screen.getByText('Перерасход масла')).toBeTruthy();
    const workerCalls = workersGetMock.mock.calls.filter((c) => c[0] === '/workers');
    expect(workerCalls).toHaveLength(1);
  });

  it('plans order from insight with chosen worker', async () => {
    const u = userEvent.setup();
    renderWithProviders(<ManagerDashboard />);
    await waitFor(() => expect(screen.getByText('Простои насоса')).toBeTruthy());
    const selects = screen.getAllByLabelText('Исполнитель');
    await u.selectOptions(selects[0], 'w1');
    await u.click(screen.getAllByRole('button', { name: 'Создать плановый наряд' })[0]);
    await waitFor(() =>
      expect(planMock).toHaveBeenCalledWith(
        'i1',
        expect.objectContaining({ assignee_id: 'w1' }),
        expect.any(String),
      ),
    );
    await waitFor(() => expect(screen.getByText('Плановый наряд создан')).toBeTruthy());
  });

  it('renders KPI cards from dashboard', async () => {
    renderWithProviders(<ManagerDashboard />);
    await waitFor(() => expect(screen.getByText('Закрыто')).toBeTruthy());
    expect(screen.getByText('10')).toBeTruthy();
  });

  it('loads and renders the real daily created-versus-closed trend', async () => {
    renderWithProviders(<ManagerDashboard />);
    await waitFor(() => expect(screen.getByRole('img', { name: 'Динамика' })).toBeTruthy());
    expect(analyticsMock).toHaveBeenCalledWith('trends', { days: '30' });
  });

  it('renders names, score and a transparent breakdown from the backend rating contract', async () => {
    analyticsMock.mockImplementation(async (path: string) => {
      if (path === 'dashboard') return { kpis: {} };
      if (path === 'insights') return { items: [] };
      if (path === 'ratings')
        return {
          data: [
            {
              id: 'worker-1',
              name: 'Айжан',
              rating: 77,
              closed: 10,
              total: 12,
              quality: 0.8,
              on_time: 0.9,
              rework_rate: 0.1,
              volume: 0.25,
              rejected: 0.05,
              low_data: false,
            },
          ],
        };
      return {};
    });
    renderWithProviders(<ManagerDashboard />);
    await waitFor(() => expect(screen.getByText('Айжан')).toBeTruthy());
    expect(screen.getByText('77.0')).toBeTruthy();
    expect(screen.getByText('80%')).toBeTruthy();
  });
});
