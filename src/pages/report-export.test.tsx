// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportExportPanel } from './ManagerDashboard';
import { renderWithProviders } from '../test-utils';

const exportsMock = vi.hoisted(() => ({
  create: vi.fn(),
  status: vi.fn(),
}));

vi.mock('../api/misc', () => ({
  analyticsGet: vi.fn(),
  exportReport: exportsMock.create,
  exportStatus: exportsMock.status,
}));
vi.mock('../api/ai', () => ({ planOrderFromInsight: vi.fn() }));
vi.mock('../hooks/useWS', () => ({
  useRealtime: () => ({ status: 'closed', reconnected: false }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  exportsMock.create.mockResolvedValue({ job_id: 'job-1', status: 'queued' });
  exportsMock.status.mockResolvedValue({
    job_id: 'job-1',
    status: 'completed',
    url: 'https://files.local/signed.xlsx',
  });
});

describe('report export workflow', () => {
  it('queues a date-filtered Excel export and exposes the completed signed link', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReportExportPanel />);

    await user.type(screen.getByLabelText('С даты'), '2026-10-01');
    await user.type(screen.getByLabelText('По дату'), '2026-10-13');
    await user.selectOptions(screen.getByLabelText('Формат'), 'xlsx');
    await user.click(screen.getByRole('button', { name: 'Подготовить отчёт' }));

    await waitFor(() =>
      expect(exportsMock.create).toHaveBeenCalledWith({
        type: 'orders',
        format: 'xlsx',
        filters: { from: '2026-10-01T00:00:00.000Z', to: '2026-10-14T00:00:00.000Z' },
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Скачать отчёт' })).toHaveAttribute(
        'href',
        'https://files.local/signed.xlsx',
      ),
    );
    expect(exportsMock.status).toHaveBeenCalledWith('job-1');
  });

  it('reports a generation failure without presenting a download action', async () => {
    exportsMock.status.mockResolvedValue({
      job_id: 'job-1',
      status: 'failed',
      error: 'storage offline',
    });
    const user = userEvent.setup();
    renderWithProviders(<ReportExportPanel />);

    await user.click(screen.getByRole('button', { name: 'Подготовить отчёт' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('storage offline'));
    expect(screen.queryByRole('link', { name: 'Скачать отчёт' })).toBeNull();
  });

  it('prevents an inverted date range from being submitted', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReportExportPanel />);
    await user.type(screen.getByLabelText('С даты'), '2026-10-13');
    await user.type(screen.getByLabelText('По дату'), '2026-10-01');

    expect(screen.getByRole('button', { name: 'Подготовить отчёт' })).toBeDisabled();
    expect(exportsMock.create).not.toHaveBeenCalled();
  });
});
