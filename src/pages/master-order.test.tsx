// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import MasterOrder from './MasterOrder';
import { testQueryClient } from '../test-utils';
import '../i18n/config';
import type { WorkOrder } from '../types/domain';

const woMocks = vi.hoisted(() => ({
  getEquipmentHistory: vi.fn(
    async (
      _id: string,
    ): Promise<
      {
        id: string;
        number: number;
        status: string;
        issued_at: string;
        fault_code_id: string;
        fault_name: string;
        work_done_text?: string;
      }[]
    > => [],
  ),
  getWorkOrder: vi.fn(),
  transitionOrder: vi.fn(async () => ({})),
}));

vi.mock('../api/workOrders', () => woMocks);
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

const order: WorkOrder = {
  id: 'o1',
  number: 5,
  status: 'done',
  priority: 'normal',
  description: 'Готово к приёмке',
  equipment_id: 'e1',
  allowed_actions: ['close', 'return_to_rework', 'reassign', 'cancel'],
};

function renderOrder(actions: string[] = order.allowed_actions) {
  woMocks.getWorkOrder.mockResolvedValue({ ...order, allowed_actions: actions });
  render(
    <MemoryRouter initialEntries={['/master/orders/o1']}>
      <QueryClientProvider client={testQueryClient()}>
        <Routes>
          <Route path="/master/orders/:id" element={<MasterOrder />} />
          <Route path="/master/review/:id" element={<div>REVIEW_PAGE</div>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MasterOrder', () => {
  it('renders order with status and actions list', async () => {
    renderOrder();
    await waitFor(() => expect(screen.getByText('Готово к приёмке')).toBeTruthy());
    expect(screen.getByText('Исполнено')).toBeTruthy();
  });

  it('shows recent repair outcomes and repeat-fault signals for the same equipment', async () => {
    woMocks.getEquipmentHistory.mockResolvedValueOnce([
      {
        id: 'o1',
        number: 5,
        status: 'done',
        issued_at: '2026-10-13T08:00:00Z',
        fault_code_id: 'f1',
        fault_name: 'Износ подшипника',
        work_done_text: 'Подшипник заменён',
      },
      {
        id: 'o2',
        number: 4,
        status: 'closed',
        issued_at: '2026-09-20T08:00:00Z',
        fault_code_id: 'f1',
        fault_name: 'Износ подшипника',
        work_done_text: 'Смазка и регулировка',
      },
      {
        id: 'o3',
        number: 3,
        status: 'closed',
        issued_at: '2026-08-10T08:00:00Z',
        fault_code_id: 'f2',
        fault_name: 'Ослабло крепление',
      },
    ]);
    renderOrder();
    await waitFor(() =>
      expect(
        screen.getByText('Та же неисправность уже встречалась в 1 прошлых нарядах.'),
      ).toBeTruthy(),
    );
    expect(screen.getAllByRole('article')[0]).toHaveTextContent('Подшипник заменён');
    expect(screen.getByRole('link', { name: 'Наряд №4' })).toHaveAttribute(
      'href',
      '/master/orders/o2',
    );
    expect(screen.queryByText('Наряд №3')).toBeTruthy();
  });

  it('close and rework link to review page', async () => {
    const u = userEvent.setup();
    renderOrder();
    await waitFor(() => expect(screen.getByText('Готово к приёмке')).toBeTruthy());
    await u.click(screen.getByRole('link', { name: /Закрыть/ }));
    expect(screen.getByText('REVIEW_PAGE')).toBeTruthy();
  });

  it('reassigns with typed id', async () => {
    const u = userEvent.setup();
    renderOrder();
    await waitFor(() => expect(screen.getByText('Готово к приёмке')).toBeTruthy());
    await u.type(screen.getByLabelText('Исполнитель'), 'w42');
    await u.click(screen.getByRole('button', { name: 'Переназначить' }));
    await waitFor(() =>
      expect(woMocks.transitionOrder).toHaveBeenCalledWith(
        'o1',
        'reassign',
        { assignee_id: 'w42' },
        expect.any(String),
      ),
    );
  });

  it('generic action posts directly', async () => {
    const u = userEvent.setup();
    renderOrder();
    await waitFor(() => expect(screen.getByText('Готово к приёмке')).toBeTruthy());
    await u.click(screen.getByRole('button', { name: 'Отменить' }));
    await waitFor(() =>
      expect(woMocks.transitionOrder).toHaveBeenCalledWith('o1', 'cancel', {}, expect.any(String)),
    );
  });

  it('shows no-actions banner when empty', async () => {
    renderOrder([]);
    await waitFor(() =>
      expect(screen.getByText('Нет доступных действий — обновите экран.')).toBeTruthy(),
    );
  });

  it('shows mutation error', async () => {
    const u = userEvent.setup();
    woMocks.transitionOrder.mockRejectedValueOnce(new Error('conflict'));
    renderOrder(['cancel']);
    await waitFor(() => expect(screen.getByText('Готово к приёмке')).toBeTruthy());
    await u.click(screen.getByRole('button', { name: 'Отменить' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });

  it('shows the backend current version and refreshes after a version conflict', async () => {
    const u = userEvent.setup();
    woMocks.transitionOrder.mockRejectedValueOnce(
      Object.assign(new Error('version conflict'), {
        isAxiosError: true,
        response: {
          status: 409,
          data: {
            error: {
              code: 'version_conflict',
              message: 'Наряд изменён',
              translation_key: 'error.version_conflict',
              details: { current_version: 3 },
            },
            request_id: 'r1',
          },
        },
      }),
    );
    renderOrder(['cancel']);
    await waitFor(() => expect(screen.getByText('Готово к приёмке')).toBeTruthy());
    await u.click(screen.getByRole('button', { name: 'Отменить' }));

    expect(
      await screen.findByText('Данные изменились (версия 3). Обновите и повторите.'),
    ).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Обновить и повторить' }));
    await waitFor(() => expect(woMocks.getWorkOrder).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/Данные изменились/)).toBeNull();
  });
});
