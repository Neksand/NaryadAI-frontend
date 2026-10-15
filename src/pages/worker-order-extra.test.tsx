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

const netState = vi.hoisted(() => ({ online: true }));
const enqueueMock = vi.hoisted(() => vi.fn(async () => {}));
const woMocks = vi.hoisted(() => ({
  getWorkOrder: vi.fn(),
  getOrderEvents: vi.fn(async () => []),
  transitionOrder: vi.fn(async () => ({})),
}));
const photoMocks = vi.hoisted(() => ({
  uploadPhoto: vi.fn(async () => ({ id: 'p1' })),
  listOrderPhotos: vi.fn(async () => []),
  describePhotoFailure: () => 'diag',
  ensureFileReadable: async () => {},
}));
const suggestMock = vi.hoisted(() => vi.fn(async () => null));

const dictMock = vi.hoisted(() => vi.fn(async (): Promise<unknown[]> => []));
vi.mock('../api/workOrders', () => woMocks);
vi.mock('../api/misc', () => ({ dictList: dictMock }));
vi.mock('../api/photos', () => photoMocks);
vi.mock('../api/ai', () => ({ suggestFaultCode: suggestMock }));
vi.mock('../hooks/useOfflineQueue', () => ({
  useOfflineQueue: () => ({
    queue: [],
    online: netState.online,
    enqueue: enqueueMock,
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
  status: 'in_progress',
  priority: 'high',
  kind: 'unplanned',
  description: 'Внеплановый ремонт',
  equipment_id: 'e1',
  allowed_actions: ['start', 'complete'],
};

function renderOrder() {
  woMocks.getWorkOrder.mockResolvedValue({ ...order });
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
  netState.online = true;
  woMocks.getOrderEvents.mockResolvedValue([]);
  photoMocks.listOrderPhotos.mockResolvedValue([]);
  suggestMock.mockResolvedValue(null);
});

describe('WorkerOrder photos', () => {
  it('uploads after-photo with progress percent', async () => {
    const u = userEvent.setup();
    photoMocks.uploadPhoto.mockImplementationOnce(
      async (_f: unknown, _k: unknown, _id: unknown, onPct?: (n: number) => void) => {
        onPct?.(50);
        return { id: 'p1' };
      },
    );
    renderOrder();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Завершить' })).toBeTruthy());
    await u.click(screen.getAllByRole('button', { name: 'Завершить' })[0]);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await u.upload(input, new File(['img'], 'after.jpg', { type: 'image/jpeg' }));
    await waitFor(() =>
      expect(photoMocks.uploadPhoto).toHaveBeenCalledWith(
        expect.any(File),
        'after',
        'o1',
        expect.any(Function),
      ),
    );
  });

  it('warns unplanned orders without after-photo', async () => {
    const u = userEvent.setup();
    renderOrder();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Завершить' })).toBeTruthy());
    await u.click(screen.getAllByRole('button', { name: 'Завершить' })[0]);
    expect(screen.getByText(/иначе сервер не примет завершение/)).toBeTruthy();
  });

  it('shows upload error banner', async () => {
    const u = userEvent.setup();
    photoMocks.uploadPhoto.mockRejectedValueOnce(new Error('file_too_large'));
    renderOrder();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Завершить' })).toBeTruthy());
    await u.click(screen.getAllByRole('button', { name: 'Завершить' })[0]);
    await u.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      new File(['img'], 'a.jpg', { type: 'image/jpeg' }),
    );
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });
});

describe('WorkerOrder AI and timeline', () => {
  it('applies suggested fault code', async () => {
    const u = userEvent.setup();
    dictMock.mockResolvedValue([{ id: 'f9', code: 'F9', name: 'Трещина' }]);
    suggestMock.mockResolvedValueOnce({
      fault_code_id: 'f9',
      code: 'F9',
      name: 'Трещина',
      confidence: 0.7,
    });
    renderOrder();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Завершить' })).toBeTruthy());
    await u.click(screen.getAllByRole('button', { name: 'Завершить' })[0]);
    await u.click(screen.getByRole('button', { name: /Рекомендация ИИ/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Применить: F9' })).toBeTruthy());
    await u.click(screen.getByRole('button', { name: 'Применить: F9' }));
    expect((screen.getByLabelText(/Шифр неисправности/) as HTMLSelectElement).value).toBe('f9');
  });

  it('renders timeline events', async () => {
    woMocks.getOrderEvents.mockResolvedValue([
      { action: 'accept', at: '2026-10-12T08:00:00', actor: 'w1' },
      { action: 'pause', at: '2026-10-12T09:00:00', actor: 'w1' },
    ]);
    renderOrder();
    await waitFor(() => expect(screen.getByText('Хронология')).toBeTruthy());
    expect(screen.getByText(/Принять в работу/)).toBeTruthy();
    expect(screen.getByText(/Пауза/)).toBeTruthy();
  });
});

describe('WorkerOrder offline', () => {
  it('queues action when offline and shows banner', async () => {
    const u = userEvent.setup();
    netState.online = false;
    renderOrder();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Начать' })).toBeTruthy());
    await u.click(screen.getByRole('button', { name: 'Начать' }));
    await waitFor(() =>
      expect(enqueueMock).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 'o1',
          action: 'start',
        }),
      ),
    );
    expect(screen.getByText(/Нет связи/)).toBeTruthy();
    expect(woMocks.transitionOrder).not.toHaveBeenCalled();
  });
});
