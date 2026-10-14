// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminPage from './Admin';
import { renderWithProviders } from '../test-utils';

const apiMocks = vi.hoisted(() => ({
  catalogList: vi.fn(async (): Promise<unknown[]> => []),
  createEmployee: vi.fn(async () => ({ id: 'new1' })),
  deleteDict: vi.fn(async () => {}),
  dictCreate: vi.fn(async () => ({})),
  dictList: vi.fn(async (): Promise<unknown[]> => []),
  patchDict: vi.fn(async () => {}),
  resetPin: vi.fn(async () => {}),
  unblockUser: vi.fn(async () => {}),
}));

vi.mock('../api/misc', () => apiMocks);
vi.mock('../hooks/useWS', () => ({
  useRealtime: () => ({ status: 'closed', reconnected: false }),
}));

const employees = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `emp-${i}`,
    login: `worker${i}`,
    full_name: `Работник ${i}`,
    role: 'worker',
  }));

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.catalogList.mockResolvedValue([]);
  apiMocks.dictList.mockResolvedValue(employees(3));
});

describe('AdminPage employees', () => {
  async function openEmployees() {
    const u = userEvent.setup();
    renderWithProviders(<AdminPage />);
    await waitFor(() => expect(screen.getByText(/Работник 0/)).toBeTruthy());
    await u.click(screen.getByRole('button', { name: 'Сотрудники' }));
    await waitFor(() => expect(screen.getByText(/worker0/)).toBeTruthy());
    return u;
  }

  it('renders employee rows', async () => {
    await openEmployees();
    expect(screen.getByText(/Работник 0/)).toBeTruthy();
  });

  it('resets pin only with valid 4-8 digits', async () => {
    const u = await openEmployees();
    const pinInput = screen.getAllByPlaceholderText('новый ПИН')[0] as HTMLInputElement;
    const pinBtn = screen.getAllByRole('button', { name: 'ПИН' })[0] as HTMLButtonElement;
    expect(pinBtn.disabled).toBe(true);
    await u.type(pinInput, '12');
    expect(pinBtn.disabled).toBe(true);
    await u.type(pinInput, '34');
    expect(pinBtn.disabled).toBe(false);
    await u.click(pinBtn);
    await waitFor(() => expect(apiMocks.resetPin).toHaveBeenCalledWith('emp-0', '1234'));
  });

  it('unblocks with one click', async () => {
    const u = await openEmployees();
    await u.click(screen.getAllByRole('button', { name: 'Разблокировать' })[0]);
    await waitFor(() => expect(apiMocks.unblockUser).toHaveBeenCalledWith('emp-0'));
  });

  it('delete requires confirmation', async () => {
    const u = await openEmployees();
    await u.click(screen.getAllByRole('button', { name: 'Удалить' })[0]);
    expect(apiMocks.deleteDict).not.toHaveBeenCalled();
    await u.click(screen.getByRole('button', { name: 'Точно удалить?' }));
    await waitFor(() => expect(apiMocks.deleteDict).toHaveBeenCalledWith('employees', 'emp-0'));
  });

  it('creates employee when form is valid', async () => {
    const u = await openEmployees();
    const createBtn = screen.getByRole('button', { name: 'Создать +' });
    expect((createBtn as HTMLButtonElement).disabled).toBe(true);
    await u.type(screen.getByPlaceholderText('логин (например worker16)'), 'worker16');
    await u.type(screen.getByPlaceholderText('ПИН 4–8 цифр'), '1001');
    await u.type(screen.getByPlaceholderText('ФИО'), 'Новый Человек');
    expect((createBtn as HTMLButtonElement).disabled).toBe(false);
    await u.click(createBtn);
    await waitFor(() =>
      expect(apiMocks.createEmployee).toHaveBeenCalledWith(
        expect.objectContaining({ login: 'worker16', pin: '1001', full_name: 'Новый Человек' }),
      ),
    );
  });

  it('paginates long tables', async () => {
    apiMocks.dictList.mockResolvedValue(employees(55));
    const u = await openEmployees();
    expect(screen.queryByText(/worker54/)).toBeNull();
    await u.click(screen.getByRole('button', { name: /Показать ещё \(5\)/ }));
    expect(screen.getByText(/worker54/)).toBeTruthy();
  });

  it('switching type shows generic create form', async () => {
    const u = await openEmployees();
    await u.click(screen.getByRole('button', { name: 'Шифры' }));
    expect(screen.getByText(/Шифры — Создать/)).toBeTruthy();
  });
});
