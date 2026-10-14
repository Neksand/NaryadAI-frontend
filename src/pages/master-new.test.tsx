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
const uploadMock = vi.hoisted(() => vi.fn(async () => ({ id: 'ph1' })));
const apiGetMock = vi.hoisted(() => vi.fn(async () => ({ data: [] })));

vi.mock('../api/workOrders', () => woMocks);
vi.mock('../api/ai', () => ({ suggestAssignee: aiMock }));
vi.mock('../api/misc', () => ({ catalogList: miscMock }));
vi.mock('../api/photos', () => ({ uploadPhoto: uploadMock }));
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
const crews = [{ id: 'c1', name: 'Бригада 1' }];

function renderNew() {
  render(
    <MemoryRouter initialEntries={['/master/new']}>
      <QueryClientProvider client={testQueryClient()}>
        <Routes>
          <Route path="/master/new" element={<MasterNew />} />
          <Route path="/master/orders/:id" element={<div>ORDER_CREATED</div>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

async function fillValid(u: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('option', { name: 'Участок 1' });
  await screen.findByRole('option', { name: 'Иван' });
  await u.selectOptions(screen.getByLabelText(/Участок/), 'a1');
  await u.selectOptions(screen.getByLabelText(/Оборудование/), 'e1');
  await u.type(screen.getByPlaceholderText('дд.мм.гггг, чч:мм'), '12.10.2026, 09:05');
  await u.type(
    document.querySelector('textarea') as HTMLTextAreaElement,
    'Течь масла из редуктора',
  );
  await u.selectOptions(screen.getByLabelText(/Исполнитель — человек или бригада/), 'w1');
}

async function waitOptions() {
  await screen.findByRole('option', { name: 'Участок 1' });
  await screen.findByRole('option', { name: 'Иван' });
}

beforeEach(() => {
  vi.clearAllMocks();
  miscMock.mockImplementation(async (name: string) => {
    if (name === 'sites') return areas;
    if (name === 'equipment') return equipment;
    if (name === 'teams') return crews;
    return [];
  });
  apiGetMock.mockResolvedValue({ data: workers });
});

describe('MasterNew kind and validation', () => {
  it('toggles kind with radio semantics', async () => {
    const u = userEvent.setup();
    renderNew();
    const planned = screen.getByRole('radio', { name: 'Плановый' });
    expect(planned).toHaveAttribute('aria-checked', 'false');
    await u.click(planned);
    expect(planned).toHaveAttribute('aria-checked', 'true');
  });

  it('submit stays disabled until form is complete', async () => {
    const u = userEvent.setup();
    renderNew();
    await waitOptions();
    const submit = screen.getByRole('button', { name: 'Новый наряд' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await u.selectOptions(screen.getByLabelText(/Участок/), 'a1');
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it('creates order and navigates to it', async () => {
    const u = userEvent.setup();
    renderNew();
    await fillValid(u);
    const submit = screen.getByRole('button', { name: 'Новый наряд' });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    await u.click(submit);
    await waitFor(() =>
      expect(woMocks.createWorkOrder).toHaveBeenCalledWith(
        expect.objectContaining({ equipment_id: 'e1', assignee_id: 'w1' }),
        expect.any(String),
      ),
    );
    expect(screen.getByText('ORDER_CREATED')).toBeTruthy();
  });

  it('shows backend error', async () => {
    const u = userEvent.setup();
    woMocks.createWorkOrder.mockRejectedValueOnce(new Error('server down'));
    renderNew();
    await fillValid(u);
    await u.click(screen.getByRole('button', { name: 'Новый наряд' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });
});

describe('MasterNew assignee logic', () => {
  it('choosing worker clears crew and vice versa', async () => {
    const u = userEvent.setup();
    renderNew();
    await waitOptions();
    const assignee = screen.getByLabelText(/Исполнитель — человек или бригада/);
    const crew = screen.getByLabelText(/Бригада/);
    await u.selectOptions(assignee, 'w1');
    expect((crew as HTMLSelectElement).value).toBe('');
    await u.selectOptions(crew, 'c1');
    expect((assignee as HTMLSelectElement).value).toBe('');
  });

  it('warns when no areas', async () => {
    miscMock.mockResolvedValue([]);
    apiGetMock.mockResolvedValue({ data: [] });
    renderNew();
    await waitFor(() => expect(screen.getByText(/привязать участки вашей учётке/)).toBeTruthy());
  });

  it('warns when no workers on areas', async () => {
    apiGetMock.mockResolvedValue({ data: [] });
    renderNew();
    await waitFor(() => expect(screen.getByText(/Администратор добавляет их там же/)).toBeTruthy());
  });
});

describe('MasterNew AI and photo', () => {
  it('suggests assignee and applies it', async () => {
    const u = userEvent.setup();
    aiMock.mockResolvedValueOnce([{ employee_id: 'w1', full_name: 'Иван', score: 0.9 }]);
    renderNew();
    await waitOptions();
    await u.selectOptions(screen.getByLabelText(/Участок/), 'a1');
    await u.type(document.querySelector('textarea') as HTMLTextAreaElement, 'Течь масла');
    const aiBtn = screen.getByRole('button', { name: /Рекомендация ИИ/ });
    expect((aiBtn as HTMLButtonElement).disabled).toBe(false);
    await u.click(aiBtn);
    await waitFor(() =>
      expect(aiMock).toHaveBeenCalledWith(expect.objectContaining({ area_id: 'a1' })),
    );
    await u.click(screen.getByRole('button', { name: 'Применить' }));
    expect(
      (screen.getByLabelText(/Исполнитель — человек или бригада/) as HTMLSelectElement).value,
    ).toBe('w1');
  });

  it('AI button is disabled without area and description', async () => {
    renderNew();
    expect(
      (screen.getByRole('button', { name: /Рекомендация ИИ/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('before-photo success shows counter', async () => {
    const u = userEvent.setup();
    renderNew();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['img'], 'a.jpg', { type: 'image/jpeg' });
    await u.upload(input, file);
    await waitFor(() => expect(uploadMock).toHaveBeenCalled());
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('shows ranked similar repairs and applies past work into the description', async () => {
    const u = userEvent.setup();
    woMocks.getSimilarRepairs.mockResolvedValueOnce([
      {
        id: 'r1',
        number: 7,
        fault_code: 'М-02',
        fault_name: 'Износ подшипника',
        work_done_text: 'Заменили подшипник',
        materials: [{ name: 'Подшипник', quantity: 2, unit: 'шт' }],
        match_score: 0.9,
        match_reasons: ['тот же шифр неисправности'],
      },
    ]);
    renderNew();
    await waitOptions();
    await u.selectOptions(screen.getByLabelText(/Оборудование/), 'e1');
    await waitFor(() => expect(woMocks.getSimilarRepairs).toHaveBeenCalledWith('e1', { limit: 3 }));
    expect(await screen.findByText(/Заменили подшипник/)).toBeTruthy();
    expect(screen.getByText(/Тот же шифр неисправности/i)).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Взять в описание' }));
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toContain(
      'Заменили подшипник',
    );
  });

  it('before-photo failure shows error banner', async () => {
    const u = userEvent.setup();
    uploadMock.mockRejectedValueOnce(new Error('too big'));
    renderNew();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await u.upload(input, new File(['img'], 'a.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });
});
