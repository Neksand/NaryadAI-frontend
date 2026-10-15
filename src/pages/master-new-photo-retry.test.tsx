// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import MasterNew from './MasterNew';
import { testQueryClient } from '../test-utils';
import '../i18n/config';

const woMocks = vi.hoisted(() => ({
  createWorkOrder: vi.fn(async () => ({ id: 'n9' })),
  getSimilarRepairs: vi.fn(async () => [] as unknown[]),
}));
const aiMock = vi.hoisted(() => vi.fn(async () => []));
const miscMock = vi.hoisted(() => vi.fn(async () => []));
const photoMocks = vi.hoisted(() => ({
  uploadPhoto: vi.fn(async () => ({ id: 'ph1' })),
  deletePhoto: vi.fn(async () => {}),
}));
const offlinePhotoMocks = vi.hoisted(() => ({
  saveOfflinePhoto: vi.fn(async () => ({ localId: 'loc1', kind: 'before' })),
  removeOfflinePhotos: vi.fn(async () => {}),
}));
const queueMocks = vi.hoisted(() => ({
  online: true,
  enqueue: vi.fn(async () => {}),
}));
const apiGetMock = vi.hoisted(() => vi.fn(async () => ({ data: [] })));

vi.mock('../api/workOrders', () => woMocks);
vi.mock('../api/ai', () => ({ suggestAssignee: aiMock }));
vi.mock('../api/misc', () => ({ catalogList: miscMock }));
vi.mock('../api/photos', () => photoMocks);
vi.mock('../lib/offline-photos', () => offlinePhotoMocks);
vi.mock('../hooks/useOfflineQueue', () => ({
  useOfflineQueue: () => ({
    queue: [],
    online: queueMocks.online,
    enqueue: queueMocks.enqueue,
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
  return { ...actual, api: { get: apiGetMock, post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

const areas = [{ id: 'a1', name: 'Участок 1' }];
const equipment = [{ id: 'e1', name: 'Насос 1' }];
const workers = [{ id: 'w1', full_name: 'Иван' }];

function renderNew() {
  render(
    <MemoryRouter initialEntries={['/master/new']}>
      <QueryClientProvider client={testQueryClient()}>
        <Routes>
          <Route path="/master/new" element={<MasterNew />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  queueMocks.online = true;
  photoMocks.uploadPhoto.mockResolvedValue({ id: 'ph1' });
  photoMocks.deletePhoto.mockResolvedValue(undefined);
  offlinePhotoMocks.saveOfflinePhoto.mockResolvedValue({ localId: 'loc1', kind: 'before' });
  offlinePhotoMocks.removeOfflinePhotos.mockResolvedValue(undefined);
  miscMock.mockImplementation(async (name: string) => {
    if (name === 'sites') return areas;
    if (name === 'equipment') return equipment;
    if (name === 'teams') return [];
    return [];
  });
  apiGetMock.mockResolvedValue({ data: workers });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('MasterNew photo retry', () => {
  it('retry повторяет тот же файл без перевыбора', async () => {
    const u = userEvent.setup();
    photoMocks.uploadPhoto.mockRejectedValueOnce(new Error('network fail'));
    renderNew();
    await screen.findByRole('option', { name: 'Участок 1' });
    const gallery = (await screen.findByLabelText('Галерея')) as HTMLInputElement;
    const file = new File(['img'], 'a.jpg', { type: 'image/jpeg' });
    await u.upload(gallery, file);
    await waitFor(() => expect(photoMocks.uploadPhoto).toHaveBeenCalledTimes(1));
    const firstArg = photoMocks.uploadPhoto.mock.calls[0][0] as File;
    // Ошибка видна, кнопка «Повторить» есть
    const retry = await screen.findByRole('button', { name: 'Повторить' });
    expect(await screen.findByRole('alert')).toBeTruthy();
    // Повтор без перевыбора — тот же файл
    photoMocks.uploadPhoto.mockResolvedValueOnce({ id: 'ph2' });
    await u.click(retry);
    await waitFor(() => expect(photoMocks.uploadPhoto).toHaveBeenCalledTimes(2));
    const secondArg = photoMocks.uploadPhoto.mock.calls[1][0] as File;
    expect(secondArg).toBe(firstArg);
    // После успеха превью появилось, ошибка ушла
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(await screen.findByLabelText('Удалить фото ph2')).toBeTruthy();
  });

  it('счётчик и дизейбл на лимите 5', async () => {
    const u = userEvent.setup();
    let n = 0;
    photoMocks.uploadPhoto.mockImplementation(async () => ({ id: `ph${++n}` }));
    renderNew();
    await screen.findByRole('option', { name: 'Участок 1' });
    // Стартовый счётчик
    expect(await screen.findByText('Фото 0 из 5')).toBeTruthy();
    for (let i = 0; i < 5; i++) {
      const gallery = (await screen.findByLabelText('Галерея')) as HTMLInputElement;
      await u.upload(gallery, new File([`img${i}`], `p${i}.jpg`, { type: 'image/jpeg' }));
      await waitFor(() => expect(photoMocks.uploadPhoto).toHaveBeenCalledTimes(i + 1));
    }
    expect(await screen.findByText('Фото 5 из 5')).toBeTruthy();
    // input дизейблится с подсказкой
    const gallery = (await screen.findByLabelText('Галерея')) as HTMLInputElement;
    const camera = (await screen.findByLabelText('Снять фото')) as HTMLInputElement;
    expect(gallery.disabled).toBe(true);
    expect(camera.disabled).toBe(true);
    expect(await screen.findByRole('note')).toBeTruthy();
    // Лишний файл не грузится
    await waitFor(() => expect(photoMocks.uploadPhoto).toHaveBeenCalledTimes(5));
  });

  it('heic-хинт без сетевого вызова', async () => {
    const u = userEvent.setup();
    renderNew();
    await screen.findByRole('option', { name: 'Участок 1' });
    const gallery = (await screen.findByLabelText('Галерея')) as HTMLInputElement;
    await u.upload(gallery, new File(['heic'], 'photo.heic', { type: 'image/heic' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/снимите камерой/i);
    expect(alert.textContent).toMatch(/JPEG\/PNG/);
    expect(photoMocks.uploadPhoto).not.toHaveBeenCalled();
    expect(offlinePhotoMocks.saveOfflinePhoto).not.toHaveBeenCalled();
    // Для HEIC повтора нет — грузить нечего
    expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull();

    // Вариант по MIME-типу
    const gallery2 = (await screen.findByLabelText('Галерея')) as HTMLInputElement;
    await u.upload(gallery2, new File(['heic'], 'photo.jpg', { type: 'image/heic' }));
    const alert2 = await screen.findByRole('alert');
    expect(alert2.textContent).toMatch(/JPEG\/PNG/);
    expect(photoMocks.uploadPhoto).not.toHaveBeenCalled();
  });

  it('форма и уже загруженные фото переживают ошибку', async () => {
    const u = userEvent.setup();
    let n = 0;
    photoMocks.uploadPhoto.mockImplementation(async () => ({ id: `ok${++n}` }));
    renderNew();
    await screen.findByRole('option', { name: 'Участок 1' });
    const gallery = (await screen.findByLabelText('Галерея')) as HTMLInputElement;
    await u.upload(gallery, new File(['one'], 'one.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(photoMocks.uploadPhoto).toHaveBeenCalledTimes(1));
    expect(await screen.findByLabelText('Удалить фото ok1')).toBeTruthy();

    // Заполняем форму
    const area = Array.from(document.querySelectorAll('select')).find((s) =>
      s.querySelector('option[value="a1"]'),
    ) as HTMLSelectElement;
    await u.selectOptions(area, 'a1');
    await u.type(document.querySelector('textarea') as HTMLTextAreaElement, 'Течь масла');

    // Вторая загрузка падает
    photoMocks.uploadPhoto.mockRejectedValueOnce(new Error('flaky network'));
    const gallery2 = (await screen.findByLabelText('Галерея')) as HTMLInputElement;
    await u.upload(gallery2, new File(['two'], 'two.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(photoMocks.uploadPhoto).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('alert')).toBeTruthy();

    // Форма и первое фото на месте
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toContain(
      'Течь масла',
    );
    expect((area as HTMLSelectElement).value).toBe('a1');
    expect(screen.getByLabelText('Удалить фото ok1')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeTruthy();
  });
});
