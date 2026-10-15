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

describe('MasterNew photo pickers', () => {
  it('renders Gallery and Camera buttons with required attributes', async () => {
    renderNew();
    const gallery = await screen.findByLabelText('Галерея');
    const camera = await screen.findByLabelText('Снять фото');
    expect(gallery).toHaveAttribute('accept', 'image/*');
    expect(gallery).not.toHaveAttribute('capture');
    expect(camera).toHaveAttribute('accept', 'image/*');
    expect(camera.getAttribute('capture')).toBe('environment');
    expect(screen.getByText('Галерея')).toBeTruthy();
    expect(screen.getByText('Снять фото')).toBeTruthy();
  });
});

describe('MasterNew photo delete', () => {
  it('happy-path: deletes uploaded photo, keeps form', async () => {
    const u = userEvent.setup();
    renderNew();
    await screen.findByRole('option', { name: 'Участок 1' });
    const gallery = (await screen.findByLabelText('Галерея')) as HTMLInputElement;
    await u.upload(gallery, new File(['img'], 'a.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(photoMocks.uploadPhoto).toHaveBeenCalled());
    const del = await screen.findByLabelText('Удалить фото ph1');
    expect(del.textContent).toContain('×');
    // fill form to verify it is preserved after delete
    await u.type(document.querySelector('textarea') as HTMLTextAreaElement, 'Течь масла');
    await u.click(del);
    await waitFor(() => expect(photoMocks.deletePhoto).toHaveBeenCalledWith('ph1'));
    await waitFor(() => expect(screen.queryByLabelText('Удалить фото ph1')).toBeNull());
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toContain(
      'Течь масла',
    );
  });

  it('shows delete error without losing form', async () => {
    const u = userEvent.setup();
    photoMocks.deletePhoto.mockRejectedValueOnce(new Error('delete failed'));
    renderNew();
    await screen.findByRole('option', { name: 'Участок 1' });
    const gallery = (await screen.findByLabelText('Галерея')) as HTMLInputElement;
    await u.upload(gallery, new File(['img'], 'a.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(photoMocks.uploadPhoto).toHaveBeenCalled());
    const del = await screen.findByLabelText('Удалить фото ph1');
    await u.type(document.querySelector('textarea') as HTMLTextAreaElement, 'Не терять');
    await u.click(del);
    await waitFor(() => expect(photoMocks.deletePhoto).toHaveBeenCalled());
    expect(await screen.findByRole('alert')).toBeTruthy();
    // photo stays, form stays
    expect(screen.getByLabelText('Удалить фото ph1')).toBeTruthy();
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toContain(
      'Не терять',
    );
  });

  it('removes offline-queued photo without calling DELETE', async () => {
    const u = userEvent.setup();
    queueMocks.online = false;
    renderNew();
    await screen.findByRole('option', { name: 'Участок 1' });
    const gallery = (await screen.findByLabelText('Галерея')) as HTMLInputElement;
    await u.upload(gallery, new File(['img'], 'b.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(offlinePhotoMocks.saveOfflinePhoto).toHaveBeenCalled());
    const del = await screen.findByLabelText('Удалить фото loc1');
    await u.click(del);
    await waitFor(() => expect(offlinePhotoMocks.removeOfflinePhotos).toHaveBeenCalled());
    expect(photoMocks.deletePhoto).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByLabelText('Удалить фото loc1')).toBeNull());
  });

  it('cancelling confirmation keeps the photo', async () => {
    const u = userEvent.setup();
    (window.confirm as unknown as ReturnType<typeof vi.spyOn>).mockReturnValueOnce(false);
    renderNew();
    await screen.findByRole('option', { name: 'Участок 1' });
    const gallery = (await screen.findByLabelText('Галерея')) as HTMLInputElement;
    await u.upload(gallery, new File(['img'], 'a.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(photoMocks.uploadPhoto).toHaveBeenCalled());
    const del = await screen.findByLabelText('Удалить фото ph1');
    await u.click(del);
    expect(photoMocks.deletePhoto).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Удалить фото ph1')).toBeTruthy();
  });
});
