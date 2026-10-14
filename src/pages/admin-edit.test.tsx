// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminPage from './Admin';
import { renderWithProviders } from '../test-utils';

const apiMocks = vi.hoisted(() => ({
  catalogList: vi.fn(async () => []),
  createEmployee: vi.fn(async () => ({ id: 'new1' })),
  deleteDict: vi.fn(async () => ({})),
  dictCreate: vi.fn(async () => ({})),
  dictList: vi.fn(async () => []),
  patchDict: vi.fn(async () => {}),
  resetPin: vi.fn(async () => {}),
  unblockUser: vi.fn(async () => ({})),
}));

vi.mock('../api/misc', () => apiMocks);
vi.mock('../hooks/useWS', () => ({
  useRealtime: () => ({ status: 'closed', reconnected: false }),
}));

const sites = [
  { id: 'a1', name: 'Участок 1' },
  { id: 'a2', name: 'Участок 2' },
];
const employees = [
  { id: 'emp-0', login: 'worker0', full_name: 'Работник 0', role: 'worker', area_ids: ['a1'] },
];

async function openEmployees() {
  const u = userEvent.setup();
  renderWithProviders(<AdminPage />);
  await waitFor(() => expect(screen.getByText('Участки')).toBeTruthy());
  await u.click(screen.getByRole('button', { name: 'Сотрудники' }));
  await waitFor(() => expect(screen.getByText(/Работник 0/)).toBeTruthy());
  return u;
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.catalogList.mockResolvedValue(sites);
  apiMocks.dictList.mockImplementation(async (type: string) =>
    type === 'employees' ? employees : [],
  );
});

describe('AdminPage edit modal', () => {
  it('opens with current values', async () => {
    const u = await openEmployees();
    await u.click(screen.getByRole('button', { name: 'Изменить' }));
    const dialog = screen.getByRole('dialog', { name: 'Редактировать сотрудника' });
    expect((within(dialog).getByLabelText('Логин') as HTMLInputElement).value).toBe('worker0');
    expect((within(dialog).getByLabelText('ФИО') as HTMLInputElement).value).toBe('Работник 0');
  });

  it('saves with toggled areas', async () => {
    const u = await openEmployees();
    await u.click(screen.getByRole('button', { name: 'Изменить' }));
    const dialog = screen.getByRole('dialog', { name: 'Редактировать сотрудника' });
    await u.click(within(dialog).getByLabelText('Участок 2'));
    await u.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(apiMocks.patchDict).toHaveBeenCalledWith(
        'employees',
        'emp-0',
        expect.objectContaining({ area_ids: ['a1', 'a2'] }),
      ),
    );
  });

  it('cancels without saving', async () => {
    const u = await openEmployees();
    await u.click(screen.getByRole('button', { name: 'Изменить' }));
    await u.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(apiMocks.patchDict).not.toHaveBeenCalled();
  });
});

describe('AdminPage generic create', () => {
  it('areas requires name and code', async () => {
    const u = userEvent.setup();
    renderWithProviders(<AdminPage />);
    await waitFor(() => expect(screen.getByText(/Участки — Создать/)).toBeTruthy());
    const create = screen.getAllByRole('button', { name: 'Создать +' })[0];
    expect((create as HTMLButtonElement).disabled).toBe(true);
  });

  it('asks kk name for bilingual types', async () => {
    renderWithProviders(<AdminPage />);
    await waitFor(() => expect(screen.getByText(/Участки — Создать/)).toBeTruthy());
    expect(screen.getByText('Название на казахском')).toBeTruthy();
  });

  it('creates area when valid', async () => {
    const u = userEvent.setup();
    renderWithProviders(<AdminPage />);
    await waitFor(() => expect(screen.getByText(/Участки — Создать/)).toBeTruthy());
    const nameInput = screen.getAllByLabelText(/Название/)[0] as HTMLInputElement;
    await u.type(nameInput, 'Новый участок');
    await u.type(screen.getByLabelText(/Код/), 'U-9');
    const create = screen.getAllByRole('button', { name: 'Создать +' })[0] as HTMLButtonElement;
    expect(create.disabled).toBe(false);
    await u.click(create);
    await waitFor(() =>
      expect(apiMocks.dictCreate).toHaveBeenCalledWith(
        'areas',
        expect.objectContaining({ name: 'Новый участок', code: 'U-9' }),
      ),
    );
  });

  it('reasons offer kind select with localized options', async () => {
    const u = userEvent.setup();
    renderWithProviders(<AdminPage />);
    await waitFor(() => expect(screen.getByText(/Участки — Создать/)).toBeTruthy());
    await u.click(screen.getByRole('button', { name: 'Причины' }));
    expect(screen.getByText('Отклонение')).toBeTruthy();
  });
});
