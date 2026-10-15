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
  deletePhoto: vi.fn(async () => {}),
}));
const offlinePhotoMocks = vi.hoisted(() => ({
  saveOfflinePhoto: vi.fn(async () => ({ localId: 'loc-after-1', kind: 'after' })),
  removeOfflinePhotos: vi.fn(async () => {}),
}));
const queueState = vi.hoisted(() => ({ online: true }));
const suggestMock = vi.hoisted(() => vi.fn());

vi.mock('../api/workOrders', () => woMocks);
vi.mock('../api/misc', () => ({ dictList: dictMock }));
vi.mock('../api/photos', () => photoMocks);
vi.mock('../lib/offline-photos', () => offlinePhotoMocks);
vi.mock('../api/ai', () => ({ suggestFaultCode: suggestMock }));
vi.mock('../hooks/useOfflineQueue', () => ({
  useOfflineQueue: () => ({
    queue: [],
    online: queueState.online,
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
  allowed_actions: ['complete'],
};

function renderOrder(serverPhotos: { id: string; kind?: string }[] = []) {
  woMocks.getWorkOrder.mockResolvedValue({ ...order, allowed_actions: ['complete'] });
  const store = [...serverPhotos];
  photoMocks.listOrderPhotos.mockImplementation(async () => [...store]);
  photoMocks.deletePhoto.mockImplementation(async (photoId: string) => {
    const idx = store.findIndex((p) => p.id === photoId);
    if (idx >= 0) store.splice(idx, 1);
  });
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

async function openComplete(u: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Завершить' })).toBeTruthy());
  await u.click(screen.getAllByRole('button', { name: 'Завершить' })[0]);
  await screen.findByRole('dialog');
}

beforeEach(() => {
  vi.clearAllMocks();
  queueState.online = true;
  woMocks.getOrderEvents.mockResolvedValue([]);
  dictMock.mockResolvedValue([{ id: 'f1', code: 'F1', name: 'Трещина' }]);
  offlinePhotoMocks.removeOfflinePhotos.mockResolvedValue(undefined);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('WorkerOrder photo pickers', () => {
  it('renders Gallery and Camera buttons with required attributes', async () => {
    const u = userEvent.setup();
    renderOrder();
    await openComplete(u);
    const gallery = await screen.findByLabelText('Галерея');
    const camera = await screen.findByLabelText('Снять фото');
    expect(gallery).toHaveAttribute('accept', 'image/*');
    expect(gallery).not.toHaveAttribute('capture');
    expect(camera).toHaveAttribute('accept', 'image/*');
    expect(camera.getAttribute('capture')).toBe('environment');
  });
});

describe('WorkerOrder photo delete', () => {
  it('happy-path: deletes server photo, keeps form', async () => {
    const u = userEvent.setup();
    renderOrder([{ id: 'srv1', kind: 'after' }]);
    await openComplete(u);
    const del = await screen.findByLabelText('Удалить фото srv1');
    expect(del.textContent).toContain('×');
    await u.type(screen.getByLabelText(/Что сделано/), 'Заменил подшипник');
    await u.click(del);
    await waitFor(() => expect(photoMocks.deletePhoto).toHaveBeenCalledWith('srv1'));
    await waitFor(() => expect(screen.queryByLabelText('Удалить фото srv1')).toBeNull());
    // форма не потеряна
    expect(screen.getByLabelText(/Что сделано/)).toHaveValue('Заменил подшипник');
  });

  it('shows delete error without losing form', async () => {
    const u = userEvent.setup();
    photoMocks.deletePhoto.mockRejectedValueOnce(new Error('cannot delete'));
    renderOrder([{ id: 'srv9', kind: 'after' }]);
    await openComplete(u);
    const del = await screen.findByLabelText('Удалить фото srv9');
    await u.type(screen.getByLabelText(/Что сделано/), 'Черновик важен');
    await u.click(del);
    await waitFor(() => expect(photoMocks.deletePhoto).toHaveBeenCalled());
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByLabelText('Удалить фото srv9')).toBeTruthy();
    expect(screen.getByLabelText(/Что сделано/)).toHaveValue('Черновик важен');
  });

  it('removes offline-queued photo without calling DELETE', async () => {
    const u = userEvent.setup();
    queueState.online = false;
    renderOrder([]);
    await openComplete(u);
    const gallery = (await screen.findByLabelText('Галерея')) as HTMLInputElement;
    await u.upload(gallery, new File(['img'], 'after.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(offlinePhotoMocks.saveOfflinePhoto).toHaveBeenCalled());
    const del = await screen.findByLabelText('Удалить фото loc-after-1');
    await u.click(del);
    await waitFor(() => expect(offlinePhotoMocks.removeOfflinePhotos).toHaveBeenCalled());
    expect(photoMocks.deletePhoto).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByLabelText('Удалить фото loc-after-1')).toBeNull());
  });
});
