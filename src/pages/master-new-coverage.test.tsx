// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import MasterNew from './MasterNew';
import { testQueryClient } from '../test-utils';
import i18n from '../i18n/config';

const mocks = vi.hoisted(() => ({
  create: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  similar: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  suggest: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  catalog: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  upload: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  get: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock('../api/workOrders', () => ({
  createWorkOrder: mocks.create,
  getSimilarRepairs: mocks.similar,
}));
vi.mock('../api/ai', () => ({ suggestAssignee: mocks.suggest }));
vi.mock('../api/misc', () => ({ catalogList: mocks.catalog }));
vi.mock('../api/photos', () => ({
  uploadPhoto: mocks.upload,
  describePhotoFailure: () => 'diag',
  ensureFileReadable: async () => {},
  photoSourceLabel: () => 'source',
}));
vi.mock('../lib/offline-photos', () => ({
  saveOfflinePhoto: async () => ({ localId: 'loc1', kind: 'before' }),
  getOfflinePhoto: async () => ({
    localId: 'loc1',
    kind: 'before',
    name: 'a.jpg',
    type: 'image/jpeg',
    data: new Blob(['img'], { type: 'image/jpeg' }),
  }),
  readStagedFile: async () => null,
  addOfflinePhotoDraftRef: async () => {},
  listOfflinePhotoDraftRefs: async () => [],
  removeOfflinePhotoDraftRefs: async () => {},
  removeOfflinePhotos: async () => {},
}));
vi.mock('../hooks/useWS', () => ({
  useRealtime: () => ({ status: 'closed', reconnected: false }),
}));
vi.mock('../components/VoiceButton', () => ({
  VoiceButton: ({ onText }: { onText: (text: string) => void }) => (
    <button onClick={() => onText('Замена уплотнения')}>Вставить расшифровку</button>
  ),
}));
vi.mock('../lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api-client')>();
  return { ...actual, api: { get: mocks.get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function renderNew() {
  render(
    <MemoryRouter initialEntries={['/master/new']}>
      <QueryClientProvider client={testQueryClient()}>
        <Routes>
          <Route path="/master/new" element={<MasterNew />} />
          <Route path="/master/orders/:id" element={<div>Наряд создан</div>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const description = () => screen.getByLabelText(/Название/);
const submit = () => screen.getByRole('button', { name: 'Новый наряд' });
const worker = () => screen.getByLabelText(/Исполнитель — человек или бригада/);
const crew = () => screen.getByLabelText(/Бригада/);
const photoInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;
const photo = (name = 'before.jpg') => new File(['image'], name, { type: 'image/jpeg' });

async function fillCrewForm(u: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('option', { name: 'Цех 1' });
  await screen.findByRole('option', { name: 'Ремонтная бригада' });
  await u.selectOptions(screen.getByLabelText(/Участок/), 'a1');
  await u.selectOptions(screen.getByLabelText(/Оборудование/), 'e1');
  await u.type(screen.getByPlaceholderText('дд.мм.гггг, чч:мм'), '30.10.2099, 09:05');
  await u.type(description(), '  Течь масла  ');
  await u.selectOptions(crew(), 'c1');
}

beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage('ru');
  mocks.create.mockResolvedValue({ id: 'new-order' });
  mocks.similar.mockResolvedValue([]);
  mocks.suggest.mockResolvedValue([]);
  mocks.upload.mockResolvedValue({ id: 'photo-1' });
  mocks.get.mockImplementation(async (url: string) => {
    if (url.startsWith('/teams/'))
      return { data: { members: [{ id: 'w1', full_name: 'Иван', current_status: 'free' }] } };
    return { data: [{ id: 'w1', full_name: 'Иван' }] };
  });
  mocks.catalog.mockImplementation(async (name) => {
    if (name === 'sites') return [{ id: 'a1', name: 'Цех 1' }];
    if (name === 'equipment') return [{ id: 'e1', name: 'Насос 1' }];
    if (name === 'teams') return [{ id: 'c1', name: 'Ремонтная бригада' }];
    return [];
  });
});

describe('MasterNew creation boundaries', () => {
  it('allows a crew order when the workers endpoint fails and sends trimmed optional fields', async () => {
    mocks.get.mockRejectedValue(new Error('Workers temporarily unavailable'));
    const u = userEvent.setup();
    renderNew();
    await fillCrewForm(u);
    expect(await screen.findByText(/Администратор добавляет их там же/)).toBeVisible();
    await u.type(screen.getByLabelText('Комментарий'), '   ');
    await u.click(screen.getByRole('radio', { name: 'Плановый' }));
    await u.selectOptions(screen.getByLabelText('Приоритет'), 'normal');
    await u.click(submit());
    await screen.findByText('Наряд создан');
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'planned',
        description: 'Течь масла',
        crew_id: 'c1',
        assignee_id: undefined,
        comment: undefined,
        priority: 'normal',
        photo_ids: [],
      }),
      expect.any(String),
    );
    const body = mocks.create.mock.calls[0][0] as Record<string, unknown>;
    expect(body).not.toHaveProperty('area_id');
    expect(new Date(body.due_at as string).getFullYear()).toBe(2099);
  });

  it('requires a non-empty title, crew keeps submit enabled', async () => {
    const u = userEvent.setup();
    renderNew();
    await fillCrewForm(u);
    await u.clear(description());
    expect(submit()).toBeDisabled();
    await u.type(description(), 'а');
    expect(submit()).toBeEnabled();
    await u.selectOptions(crew(), '');
    expect(submit()).toBeDisabled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('keeps one creation in flight and navigates only after the server returns', async () => {
    const pending = deferred<{ id: string }>();
    mocks.create.mockReturnValue(pending.promise);
    const u = userEvent.setup();
    renderNew();
    await fillCrewForm(u);
    await u.click(submit());
    const pendingSubmit = await screen.findByRole('button', { name: /Загрузка/ });
    expect(pendingSubmit).toBeDisabled();
    await u.click(pendingSubmit);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Наряд создан')).not.toBeInTheDocument();
    await act(async () => pending.resolve({ id: 'new-order' }));
    expect(await screen.findByText('Наряд создан')).toBeVisible();
  });

  it.each(['items', 'data'])('supports the workers %s envelope and name fallbacks', async (key) => {
    mocks.get.mockImplementation(async (url: string) => {
      if (url.startsWith('/teams/'))
        return {
          data: {
            members: [{ id: 'w1', name: 'Ерлан', current_status: 'unknown-status' }, { id: 'w2' }],
          },
        };
      return {
        data: {
          [key]: [{ id: 'w1', name: 'Ерлан', current_status: 'unknown-status' }, { id: 'w2' }],
        },
      };
    });
    renderNew();
    expect(await screen.findByRole('option', { name: 'Ерлан · unknown-status' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'w2' })).toBeVisible();
  });

  it('handles an empty workers envelope and an unnamed crew without losing its identifier', async () => {
    mocks.get.mockImplementation(async (url: string) => {
      if (url.startsWith('/teams/')) return { data: { members: [] } };
      return { data: {} };
    });
    mocks.catalog.mockImplementation(async (name) =>
      name === 'teams' ? [{ id: 'crew-without-name' }] : [],
    );
    renderNew();
    expect(await screen.findByRole('option', { name: 'crew-without-name' })).toHaveValue(
      'crew-without-name',
    );
    expect(await screen.findByText(/Администратор добавляет их там же/)).toBeVisible();
  });

  it('requests equipment with the selected area and clears scope when the area is removed', async () => {
    const u = userEvent.setup();
    renderNew();
    await screen.findByRole('option', { name: 'Цех 1' });
    expect(mocks.catalog).toHaveBeenCalledWith('equipment', {});
    await u.selectOptions(screen.getByLabelText(/Участок/), 'a1');
    await waitFor(() => expect(mocks.catalog).toHaveBeenCalledWith('equipment', { area_id: 'a1' }));
    await u.selectOptions(screen.getByLabelText(/Участок/), '');
    expect(screen.getByRole('button', { name: /Рекомендация ИИ/ })).toBeDisabled();
  });
});

describe('MasterNew evidence and recommendations', () => {
  it('blocks submission during upload, then includes the returned photo identifier', async () => {
    const pending = deferred<{ id: string }>();
    mocks.upload.mockReturnValue(pending.promise);
    const u = userEvent.setup();
    renderNew();
    await fillCrewForm(u);
    const file = photo();
    await u.upload(photoInput(), file);
    expect(photoInput()).toBeDisabled();
    expect(submit()).toBeDisabled();
    expect(mocks.upload).toHaveBeenCalledWith(file, 'before', undefined, expect.any(Function));
    await act(async () => pending.resolve({ id: 'verified-photo' }));
    await waitFor(() => expect(submit()).toBeEnabled());
    await u.click(submit());
    await screen.findByText('Наряд создан');
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ photo_ids: ['verified-photo'] }),
      expect.any(String),
    );
  });

  it('clears a failed-photo warning when retrying and ignores a cancelled file dialog', async () => {
    mocks.upload.mockRejectedValueOnce(new Error('Upload failed'));
    const pending = deferred<{ id: string }>();
    mocks.upload.mockReturnValueOnce(pending.promise);
    const u = userEvent.setup();
    renderNew();
    await waitFor(() => expect(photoInput()).toBeEnabled());
    fireEvent.change(photoInput(), { target: { files: [] } });
    expect(mocks.upload).not.toHaveBeenCalled();
    await u.upload(photoInput(), photo('failed.jpg'));
    expect(await screen.findByRole('alert')).toBeVisible();
    await u.upload(photoInput(), photo('retry.jpg'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(photoInput()).toBeDisabled();
    await act(async () => pending.resolve({ id: 'retry-photo' }));
    await waitFor(() => expect(photoInput()).toBeEnabled());
    expect(screen.getByText('1')).toBeVisible();
  });

  it('limits evidence to five photos even if an extra change event is dispatched', async () => {
    const u = userEvent.setup();
    renderNew();
    await waitFor(() => expect(photoInput()).toBeEnabled());
    for (let index = 1; index <= 5; index += 1) {
      mocks.upload.mockResolvedValueOnce({ id: `photo-${index}` });
      await u.upload(photoInput(), photo(`${index}.jpg`));
      await waitFor(() => expect(screen.getByText(String(index))).toBeVisible());
    }
    expect(photoInput()).toBeDisabled();
    fireEvent.change(photoInput(), { target: { files: [photo('sixth.jpg')] } });
    expect(mocks.upload).toHaveBeenCalledTimes(5);
  });

  it.each(['candidates', 'suggestions', 'data'])(
    'reads the AI %s envelope, displays explanations, and applies only on explicit click',
    async (key) => {
      mocks.suggest.mockResolvedValue({
        [key]: [
          { id: 'w1', confidence: 0.8, explanation: 'Опыт ремонта насосов' },
          { employee_id: 'w1', reasons: ['Свободен', 'Есть допуск'] },
          { employee_id: 'w1', full_name: 'Иван — резерв' },
          { employee_id: 'w1', explanation: 'Четвёртый кандидат' },
        ],
      });
      const u = userEvent.setup();
      renderNew();
      await fillCrewForm(u);
      await u.click(screen.getByRole('button', { name: /Рекомендация ИИ/ }));
      expect(await screen.findByText('Опыт ремонта насосов')).toBeVisible();
      expect(screen.getByText('Свободен; Есть допуск')).toBeVisible();
      expect(screen.getByText('Иван — резерв')).toBeVisible();
      expect(screen.queryByText('Четвёртый кандидат')).not.toBeInTheDocument();
      expect(screen.getByText(/80 %/)).toBeVisible();
      expect(worker()).toHaveValue('');
      expect(crew()).toHaveValue('c1');
      await u.click(screen.getAllByRole('button', { name: 'Применить' })[0]);
      expect(worker()).toHaveValue('w1');
      expect(crew()).toHaveValue('');
    },
  );

  it('keeps the AI request pending and handles an empty envelope without assigning anyone', async () => {
    const pending = deferred<Record<string, never>>();
    mocks.suggest.mockReturnValue(pending.promise);
    const u = userEvent.setup();
    renderNew();
    await screen.findByRole('option', { name: 'Цех 1' });
    await u.selectOptions(screen.getByLabelText(/Участок/), 'a1');
    await u.type(description(), 'Течь масла');
    const button = screen.getByRole('button', { name: /Рекомендация ИИ/ });
    await u.click(button);
    expect(button).toBeDisabled();
    expect(mocks.suggest).toHaveBeenCalledWith({
      area_id: 'a1',
      equipment_id: undefined,
      priority: 'high',
      description: 'Течь масла',
    });
    await act(async () => pending.resolve({}));
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.queryByRole('button', { name: 'Применить' })).not.toBeInTheDocument();
    expect(worker()).toHaveValue('');
  });

  it('appends transcribed speech without deleting an existing description', async () => {
    const u = userEvent.setup();
    renderNew();
    await u.click(screen.getByRole('button', { name: 'Вставить расшифровку' }));
    expect(description()).toHaveValue('Замена уплотнения');
    await u.click(screen.getByRole('button', { name: 'Вставить расшифровку' }));
    expect(description()).toHaveValue('Замена уплотнения Замена уплотнения');
  });

  it('shows loading and then empty history only after choosing equipment', async () => {
    const pending = deferred<unknown[]>();
    mocks.similar.mockReturnValue(pending.promise);
    const u = userEvent.setup();
    renderNew();
    await screen.findByRole('option', { name: 'Насос 1' });
    expect(mocks.similar).not.toHaveBeenCalled();
    await u.selectOptions(screen.getByLabelText(/Оборудование/), 'e1');
    expect(screen.getByText(/Загрузка/)).toBeVisible();
    await act(async () => pending.resolve([]));
    expect(await screen.findByText('Похожих закрытых ремонтов пока нет.')).toBeVisible();
  });

  it('handles sparse repair history and appends a useful prior outcome to existing text', async () => {
    mocks.similar.mockResolvedValue([
      { id: 'sparse' },
      { id: 'code-only', number: 21, fault_code: 'М-01', materials: [] },
      { id: 'outcome', number: 22, fault_name: 'Течь', work_done_text: 'Заменили прокладку' },
      { id: 'hidden', number: 23, work_done_text: 'Скрытый четвёртый ремонт' },
    ]);
    const u = userEvent.setup();
    renderNew();
    await screen.findByRole('option', { name: 'Насос 1' });
    await u.type(description(), 'Осмотреть насос.');
    await u.selectOptions(screen.getByLabelText(/Оборудование/), 'e1');
    expect(await screen.findByText('Наряд №—')).toBeVisible();
    expect(screen.getByText('М-01')).toBeVisible();
    expect(screen.getByText('Течь')).toBeVisible();
    expect(screen.queryByText(/Скрытый четвёртый ремонт/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Взять в описание' })).toHaveLength(1);
    await u.click(screen.getByRole('button', { name: 'Взять в описание' }));
    expect(description()).toHaveValue('Осмотреть насос. Заменили прокладку');
  });
});
