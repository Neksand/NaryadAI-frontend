// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { ForecastPanel } from './ForecastPanel';
import { renderWithProviders } from '../test-utils';

const apiGetMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api-client')>();
  return {
    ...actual,
    api: { get: apiGetMock, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const forecast = [
  { equipment_id: 'e1', equipment_name: 'Конвейер К-3', probability: 0.87, recent: 8, growth: 1 },
  { equipment_id: 'e2', equipment_name: 'Дробилка', probability: 0.42, recent: 3, growth: 0 },
  { equipment_id: 'e3', equipment_name: 'Насос', probability: 0.19, recent: 0, growth: 0 },
];

describe('ForecastPanel', () => {
  it('renders the top-5 forecast with probabilities, recent counts and growth', async () => {
    apiGetMock.mockResolvedValueOnce({ data: forecast });
    renderWithProviders(<ForecastPanel />);

    await waitFor(() => expect(screen.getByText('Конвейер К-3')).toBeTruthy());
    expect(apiGetMock).toHaveBeenCalledWith('/analytics/failure-forecast');
    expect(screen.getByLabelText('Вероятность: 87%')).toHaveTextContent('87%');
    expect(screen.getByText('Дробилка')).toBeTruthy();
    // recent + growth line for the top row
    expect(screen.getByText(/Внеплановых за 30 дней: 8/)).toBeTruthy();
  });

  it('respects the limit prop and shows an error state with retry', async () => {
    apiGetMock.mockResolvedValueOnce({ data: forecast });
    const { unmount } = renderWithProviders(<ForecastPanel limit={2} />);

    await waitFor(() => expect(screen.getByText('Конвейер К-3')).toBeTruthy());
    expect(screen.getByText('Дробилка')).toBeTruthy();
    expect(screen.queryByText('Насос')).toBeNull();
    unmount();

    apiGetMock.mockRejectedValueOnce({ response: { status: 500, data: {} } });
    renderWithProviders(<ForecastPanel />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });
});
