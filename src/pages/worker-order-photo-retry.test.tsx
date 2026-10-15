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
  photoMocks.uploadPhoto.mockResolvedValue({ id: 'p1' });
  offlinePhotoMocks.saveOfflinePhoto.mockResolvedValue({ localId: 'loc-after-1', kind: 'after' });
  offlinePhotoMocks.removeOfflinePhotos.mockResolvedValue(undefined);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('WorkerOrder photo retry', () => {
  it('retry повторяет тот же файл без перевыбора', async () => {
    const u = userEvent.setup();
    photoMocks.uploadPhoto.mockRejectedValueOnce(new Error('network fail'));
    renderOrder([]);
    await openComplete(u);
    const gallery = (await screen.findByLabelText('Выбрать фото')) as HTMLInputElement;
    const file = new File(['img'], 'after.jpg', { type: 'image/jpeg' });
    await u.upload(gallery, file);
    await waitFor(() => expect(photoMocks.uploadPhoto).toHaveBeenCalledTimes(1));
    const firstArg = photoMocks.uploadPhoto.mock.calls[0][0] as File;
    const retry = await screen.findByRole('button', { name: 'Повторить' });
    expect(await screen.findByRole('alert')).toBeTruthy();
    photoMocks.uploadPhoto.mockResolvedValueOnce({ id: 'p2' });
    await u.click(retry);
    await waitFor(() => expect(photoMocks.uploadPhoto).toHaveBeenCalledTimes(2));
    const secondArg = photoMocks.uploadPhoto.mock.calls[1][0] as File;
    expect(secondArg).toBe(firstArg);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('счётчик и дизейбл на лимите 10', async () => {
    const u = userEvent.setup();
    const ten = Array.from({ length: 10 }, (_, i) => ({ id: `srv${i}`, kind: 'after' }));
    renderOrder(ten);
    await openComplete(u);
    expect(await screen.findByText('Фото 10 из 10')).toBeTruthy();
    const picker = (await screen.findByLabelText('Выбрать фото')) as HTMLInputElement;
    expect(screen.queryByLabelText('Снять фото')).toBeNull();
    expect(picker.disabled).toBe(true);
    expect(await screen.findByRole('note')).toBeTruthy();
    // Лимит не пускает в сеть
    expect(photoMocks.uploadPhoto).not.toHaveBeenCalled();
  });

  it('счётчик ниже лимита не дизейблит', async () => {
    const u = userEvent.setup();
    renderOrder([{ id: 'srv0', kind: 'after' }]);
    await openComplete(u);
    expect(await screen.findByText('Фото 1 из 10')).toBeTruthy();
    const gallery = (await screen.findByLabelText('Выбрать фото')) as HTMLInputElement;
    expect(gallery.disabled).toBe(false);
  });

  it('heic-хинт без сетевого вызова', async () => {
    const u = userEvent.setup();
    renderOrder([]);
    await openComplete(u);
    const gallery = (await screen.findByLabelText('Выбрать фото')) as HTMLInputElement;
    await u.upload(gallery, new File(['heic'], 'img.HEIC', { type: 'image/jpeg' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/снимите камерой/i);
    expect(alert.textContent).toMatch(/JPEG\/PNG/);
    expect(photoMocks.uploadPhoto).not.toHaveBeenCalled();
    expect(offlinePhotoMocks.saveOfflinePhoto).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull();

    const gallery2 = (await screen.findByLabelText('Выбрать фото')) as HTMLInputElement;
    await u.upload(gallery2, new File(['heic'], 'img.jpg', { type: 'image/heif' }));
    const alert2 = await screen.findByRole('alert');
    expect(alert2.textContent).toMatch(/JPEG\/PNG/);
    expect(photoMocks.uploadPhoto).not.toHaveBeenCalled();
  });

  it('форма и уже загруженные фото переживают ошибку', async () => {
    const u = userEvent.setup();
    renderOrder([{ id: 'srv1', kind: 'after' }]);
    await openComplete(u);
    await u.type(screen.getByLabelText(/Что сделано/), 'Заменил подшипник');
    photoMocks.uploadPhoto.mockRejectedValueOnce(new Error('flaky'));
    const gallery = (await screen.findByLabelText('Выбрать фото')) as HTMLInputElement;
    await u.upload(gallery, new File(['x'], 'fail.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(photoMocks.uploadPhoto).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('alert')).toBeTruthy();
    // Форма и серверное фото на месте
    expect(screen.getByLabelText(/Что сделано/)).toHaveValue('Заменил подшипник');
    expect(screen.getByLabelText('Удалить фото srv1')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeTruthy();
  });
});
