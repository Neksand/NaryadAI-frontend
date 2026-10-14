// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import WorkerProfile from './WorkerProfile';
import { renderWithProviders } from '../test-utils';

const analyticsMock = vi.hoisted(() => vi.fn());
vi.mock('../api/misc', () => ({ analyticsGet: analyticsMock }));
vi.mock('../hooks/useWS', () => ({
  useRealtime: () => ({ status: 'closed', reconnected: false }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  analyticsMock.mockResolvedValue({
    data: {
      id: 'worker-1',
      name: 'Рабочий',
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
  });
});

describe('WorkerProfile rating explanation', () => {
  it('shows the score, sample size, and all five weighted rating components', async () => {
    renderWithProviders(<WorkerProfile />);
    await waitFor(() => expect(screen.getByText('77.0')).toBeTruthy());
    expect(screen.getByText('Рабочий')).toBeTruthy();
    expect(screen.getByText('Качество')).toBeTruthy();
    expect(screen.getByText('В срок')).toBeTruthy();
    expect(screen.getByText('Возвраты')).toBeTruthy();
    expect(screen.getByText('Объём')).toBeTruthy();
    expect(screen.getByText('Отклонения')).toBeTruthy();
    expect(screen.getByText('80%')).toBeTruthy();
    expect(screen.getByText(/10\/12/)).toBeTruthy();
    expect(analyticsMock).toHaveBeenCalledWith('ratings/me');
  });

  it('explains low sample size instead of presenting the score as final', async () => {
    analyticsMock.mockResolvedValueOnce({
      data: {
        id: 'worker-1',
        rating: 0,
        closed: 1,
        total: 1,
        quality: 0,
        on_time: 0,
        rework_rate: 0,
        volume: 0.025,
        rejected: 0,
        low_data: true,
      },
    });
    renderWithProviders(<WorkerProfile />);
    await waitFor(() => expect(screen.getByText(/не менее 5 нарядов/)).toBeTruthy());
  });

  it('shows an empty-data explanation instead of a misleading zero', async () => {
    analyticsMock.mockResolvedValueOnce({ data: null });
    renderWithProviders(<WorkerProfile />);
    await waitFor(() =>
      expect(screen.getByText('Пока нет данных для расчёта рейтинга.')).toBeTruthy(),
    );
  });
});
