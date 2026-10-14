// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import WorkerOrder from './WorkerOrder';
import { testQueryClient } from '../test-utils';
import '../i18n/config';
import type { WorkOrder } from '../types/domain';

const woMocks = vi.hoisted(() => ({
  getWorkOrder: vi.fn(),
  getOrderEvents: vi.fn(async () => []),
  transitionOrder: vi.fn(async () => ({})),
}));
const dictMock = vi.hoisted(() => vi.fn(async (): Promise<unknown[]> => []));
const photoMocks = vi.hoisted(() => ({
  uploadPhoto: vi.fn(async () => ({ id: 'p1' })),
  listOrderPhotos: vi.fn(async () => []),
}));
const suggestMock = vi.hoisted(() => vi.fn());

vi.mock('../api/workOrders', () => woMocks);
vi.mock('../api/misc', () => ({ dictList: dictMock }));
vi.mock('../api/photos', () => photoMocks);
vi.mock('../api/ai', () => ({ suggestFaultCode: suggestMock }));
vi.mock('../hooks/useOfflineQueue', () => ({
  useOfflineQueue: () => ({
    queue: [],
    online: true,
    enqueue: vi.fn(),
    remove: vi.fn(),
    replay: vi.fn(),
    replaying: false,
    lastReplayError: null,
    count: 0,
  }),
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

const order: WorkOrder = {
  id: 'o1',
  number: 7,
  status: 'issued',
  priority: 'high',
  kind: 'planned',
  description: 'Заменить подшипник',
  equipment_id: 'e1',
  area_id: 'a1',
  due_at: '2026-10-12T09:05:00',
  norm_minutes: 60,
  allowed_actions: ['accept', 'reject', 'pause', 'complete'],
};

function renderOrder(actions: string[] = order.allowed_actions) {
  woMocks.getWorkOrder.mockResolvedValue({ ...order, allowed_actions: actions });
  render(
    <MemoryRouter initialEntries={['/worker/orders/o1']}>
      <QueryClientProvider client={testQueryClient()}>
        <Routes>
          <Route path="/worker/orders/:id" element={<WorkerOrder />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  woMocks.getOrderEvents.mockResolvedValue([]);
  photoMocks.listOrderPhotos.mockResolvedValue([]);
});

describe('WorkerOrder actions', () => {
  it('renders backend actions with first one highlighted', async () => {
    renderOrder();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Принять в работу' })).toBeTruthy(),
    );
    const first = screen.getByRole('button', { name: 'Принять в работу' });
    expect(first.className).toContain('btn-xl');
    expect(first.closest('.dock-sticky')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Отклонить' })).toBeTruthy();
  });

  it('one-click action calls transition directly', async () => {
    const u = userEvent.setup();
    renderOrder(['accept']);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Принять в работу' })).toBeTruthy(),
    );
    await u.click(screen.getByRole('button', { name: 'Принять в работу' }));
    await waitFor(() =>
      expect(woMocks.transitionOrder).toHaveBeenCalledWith('o1', 'accept', {}, expect.any(String)),
    );
  });

  it('shows no-actions banner instead of empty actions', async () => {
    renderOrder([]);
    await waitFor(() =>
      expect(screen.getByText('Нет доступных действий — обновите экран.')).toBeTruthy(),
    );
    expect(document.querySelector('.dock-sticky')).toBeNull();
  });
});

describe('WorkerOrder reject sheet', () => {
  it('requires reason from directory', async () => {
    const u = userEvent.setup();
    dictMock.mockResolvedValue([{ code: 'sick', name: 'Болезнь' }]);
    renderOrder(['reject']);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Отклонить' })).toBeTruthy());
    await u.click(screen.getByRole('button', { name: 'Отклонить' }));
    expect(screen.getByRole('dialog', { name: 'Укажите причину' })).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Сохранить' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await u.selectOptions(screen.getByLabelText('Выберите причину из справочника'), 'sick');
    expect((save as HTMLButtonElement).disabled).toBe(false);
    await u.click(save);
    await waitFor(() =>
      expect(woMocks.transitionOrder).toHaveBeenCalledWith(
        'o1',
        'reject',
        expect.objectContaining({ reason_code: 'sick' }),
        expect.any(String),
      ),
    );
  });
});

describe('WorkerOrder complete sheet', () => {
  it('validates work text and fault code', async () => {
    const u = userEvent.setup();
    dictMock.mockResolvedValue([{ id: 'f1', code: 'F1', name: 'Трещина' }]);
    renderOrder(['complete']);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Завершить' })).toBeTruthy());
    await u.click(screen.getByRole('button', { name: 'Завершить' }));
    expect(screen.getByRole('dialog', { name: 'Завершение наряда' })).toBeTruthy();
    const done = screen.getByRole('button', { name: 'Завершить', hidden: false });
    const submitBtns = screen.getAllByRole('button', { name: 'Завершить' });
    expect((submitBtns[submitBtns.length - 1] as HTMLButtonElement).disabled).toBe(true);
    expect(done).toBeTruthy();
  });

  it('submits complete form with fault uuid', async () => {
    const u = userEvent.setup();
    dictMock.mockResolvedValue([{ id: 'f1', code: 'F1', name: 'Трещина' }]);
    renderOrder(['complete']);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Завершить' })).toBeTruthy());
    await u.click(screen.getAllByRole('button', { name: 'Завершить' })[0]);
    await u.type(document.querySelector('textarea') as HTMLTextAreaElement, 'Заменил подшипник');
    await u.selectOptions(screen.getByLabelText('Шифр неисправности *'), 'f1');
    const submit = screen.getAllByRole('button', { name: 'Завершить' }).pop() as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    await u.click(submit);
    await waitFor(() =>
      expect(woMocks.transitionOrder).toHaveBeenCalledWith(
        'o1',
        'complete',
        expect.objectContaining({
          form: expect.objectContaining({
            work_done_text: 'Заменил подшипник',
            fault_code_id: 'f1',
          }),
        }),
        expect.any(String),
      ),
    );
  });
});
