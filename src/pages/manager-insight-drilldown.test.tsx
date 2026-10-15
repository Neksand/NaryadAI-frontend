// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import ManagerDashboard from './ManagerDashboard';
import { renderWithProviders } from '../test-utils';
import i18n from '../i18n/config';

const analyticsMock = vi.hoisted(() => vi.fn());
const planMock = vi.hoisted(() => vi.fn(async () => ({ id: 'n1' })));

vi.mock('../api/misc', () => ({ analyticsGet: analyticsMock }));
vi.mock('../api/ai', () => ({ planOrderFromInsight: planMock }));
vi.mock('../hooks/useWS', () => ({
  useRealtime: () => ({ status: 'closed', reconnected: false }),
}));
vi.mock('../lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api-client')>();
  return {
    ...actual,
    api: {
      get: vi.fn(async () => ({ data: [] })),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const ORDER_A = '11111111-1111-4111-8111-111111111111';
const ORDER_B = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  analyticsMock.mockImplementation(async (path: string) => {
    if (path === 'dashboard') return { kpis: {} };
    if (path === 'trends') return { data: [] };
    if (path === 'ratings') return [];
    if (path === 'insights')
      return {
        items: [
          {
            id: 'ins-1',
            headline: 'Конвейер К-3: повторные отказы по шифру М-02 (12 за 30 дней)',
            severity: 'critical',
            confidence: 0.85,
            recommendation: 'Внеплановая диагностика',
            order_ids: [ORDER_A, ORDER_B],
            evidence: [{ metric: 'repeat_count', value: 12, baseline: 2 }],
          },
        ],
      };
    return {};
  });
});

describe('ManagerDashboard insight drill-down', () => {
  it('reveals headline, count, denominator, formula and order links with a non-causality note', async () => {
    await i18n.changeLanguage('ru');
    renderWithProviders(<ManagerDashboard />);
    await waitFor(() => expect(screen.getByText(/повторные отказы по шифру/)).toBeTruthy());
    expect(screen.getByText(/Количество/)).toBeTruthy();
    expect(screen.getByText(/Знаменатель/)).toBeTruthy();
    const code = document.querySelector('code.font-mono');
    expect(code?.textContent).toContain('n / total');
    const link = screen.getByRole('link', { name: ORDER_A.slice(0, 8) });
    expect(link).toHaveAttribute('href', `/master/orders/${ORDER_A}`);
    expect(screen.getByText(/Корреляция не доказывает причину/)).toBeVisible();
  });
});
