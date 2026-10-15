// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminPage from './Admin';
import { api } from '../lib/api-client';
import { renderWithProviders } from '../test-utils';

const mocks = vi.hoisted(() => ({
  catalogList: vi.fn(async (_type: string): Promise<unknown[]> => []),
  createEmployee: vi.fn(async (_body: unknown) => ({ id: 'created' })),
  deleteDict: vi.fn(async (_type: string, _id: string) => ({})),
  dictCreate: vi.fn(async (_type: string, _body: unknown) => ({})),
  dictList: vi.fn(async (_type: string): Promise<unknown[]> => []),
  patchDict: vi.fn(async (_type: string, _id: string, _body: unknown) => ({})),
  resetPin: vi.fn(async (_id: string, _pin: string) => ({})),
  unblockUser: vi.fn(async (_id: string) => ({})),
}));
vi.mock('../api/misc', () => mocks);
vi.mock('../hooks/useWS', () => ({
  useRealtime: () => ({ status: 'closed', reconnected: false }),
}));

const sites = [
  { id: 'a1', name: 'Цех первый', name_kk: 'Бірінші цех' },
  { id: 'a2', name: 'Цех второй' },
];
const teams = [{ id: 't1', name: 'Бригада ремонта' }];
const faultCodes = [{ id: 'f1', code: 'М-01', name: 'Подшипник' }];
const employee = {
  id: 'worker-1',
  login: 'worker01',
  full_name: 'Иван Петров',
  role: 'worker',
  shift: '2',
  crew_id: 't1',
  area_ids: ['a1'],
};
const failure = (message: string, details?: unknown) => ({
  isAxiosError: true,
  response: { status: 422, data: { error: { code: 'validation_error', message, details } } },
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  mocks.catalogList.mockImplementation(async (type) => (type === 'sites' ? sites : teams));
  mocks.dictList.mockImplementation(async (type) =>
    type === 'employees' ? [employee] : type === 'fault-codes' ? faultCodes : [],
  );
  mocks.createEmployee.mockResolvedValue({ id: 'created' });
  mocks.deleteDict.mockResolvedValue({});
  mocks.dictCreate.mockResolvedValue({});
  mocks.patchDict.mockResolvedValue({});
  mocks.resetPin.mockResolvedValue({});
  mocks.unblockUser.mockResolvedValue({});
});

async function openTab(name: string) {
  const user = userEvent.setup();
  renderWithProviders(<AdminPage />);
  await screen.findByText('Участки — Создать');
  await user.click(screen.getByRole('button', { name, exact: true }));
  if (name === 'Сотрудники') await screen.findByText(/worker01 · Иван Петров/);
  else await screen.findByText(`${name} — Создать`);
  return user;
}

function createButton() {
  return screen.getByRole('button', { name: 'Создать +' });
}

describe('admin catalog forms', () => {
  it('creates bilingual equipment with an area and explicit criticality', async () => {
    const user = await openTab('Оборудование');
    await user.type(screen.getByLabelText('Название *'), '  Насос  ');
    await user.type(screen.getByLabelText('Название на казахском'), 'Сорғы');
    await user.type(screen.getByLabelText('Инв. номер *'), 'N-8');
    await user.type(screen.getByLabelText('Тип оборудования *'), 'насос');
    expect(createButton()).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Участок *'), 'a2');
    await user.selectOptions(screen.getByLabelText('Класс (A/B/C) *'), 'A');
    await user.click(createButton());
    await waitFor(() =>
      expect(mocks.dictCreate).toHaveBeenCalledWith('equipment', {
        name: 'Насос',
        name_kk: 'Сорғы',
        inventory_no: 'N-8',
        type: 'насос',
        area_id: 'a2',
        criticality: 'A',
      }),
    );
    await waitFor(() => expect(screen.getByLabelText('Название *')).toHaveValue(''));
    expect(screen.getByLabelText('Класс (A/B/C) *')).toHaveValue('B');
    expect(createButton()).toBeDisabled();
  });

  it('requires crew area and omits empty optional translation', async () => {
    const user = await openTab('Бригады');
    await user.type(screen.getByLabelText('Название *'), 'Ремонт');
    expect(createButton()).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Участок *'), 'a1');
    await user.click(createButton());
    await waitFor(() =>
      expect(mocks.dictCreate).toHaveBeenCalledWith('crews', { name: 'Ремонт', area_id: 'a1' }),
    );
  });

  it('rejects invalid material consumption and submits a numeric decimal', async () => {
    const user = await openTab('Материалы');
    await user.type(screen.getByLabelText('Название *'), 'Масло');
    await user.selectOptions(screen.getByLabelText('Ед. изм. *'), 'л');
    const consumption = screen.getByLabelText('Типовой расход');
    for (const invalid of ['-1', '0', 'abc']) {
      await user.clear(consumption);
      await user.type(consumption, invalid);
      expect(createButton()).toBeDisabled();
    }
    await user.clear(consumption);
    await user.type(consumption, '2.5');
    await user.click(createButton());
    await waitFor(() =>
      expect(mocks.dictCreate).toHaveBeenCalledWith('materials', {
        name: 'Масло',
        unit: 'л',
        typical_usage_per_order: 2.5,
      }),
    );
  });

  it('creates a fault code with selected group and positive numeric norm', async () => {
    const user = await openTab('Шифры');
    await user.type(screen.getByLabelText('Код *'), 'Э-88');
    await user.selectOptions(screen.getByLabelText('Группа *'), 'Э');
    await user.type(screen.getByLabelText('Название *'), 'Кабель');
    await user.type(screen.getByLabelText('Норматив, мин'), '25');
    await user.click(createButton());
    await waitFor(() =>
      expect(mocks.dictCreate).toHaveBeenCalledWith('fault-codes', {
        code: 'Э-88',
        fault_group: 'Э',
        name: 'Кабель',
        default_norm_minutes: 25,
      }),
    );
  });

  it('creates a norm linked to a fault and requires positive duration', async () => {
    const user = await openTab('Нормы');
    expect(screen.queryByLabelText('Название на казахском')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Шифр неисправности *'), 'f1');
    await user.type(screen.getByLabelText('Тип оборудования *'), 'насос');
    await user.type(screen.getByLabelText('Минуты *'), '0');
    expect(createButton()).toBeDisabled();
    await user.clear(screen.getByLabelText('Минуты *'));
    await user.type(screen.getByLabelText('Минуты *'), '45');
    await user.click(createButton());
    await waitFor(() =>
      expect(mocks.dictCreate).toHaveBeenCalledWith('norms', {
        fault_code_id: 'f1',
        equipment_type: 'насос',
        minutes: 45,
      }),
    );
  });

  it('creates pause reasons and restores the default reject kind', async () => {
    const user = await openTab('Причины');
    await user.selectOptions(screen.getByLabelText('Вид причины *'), 'pause');
    await user.type(screen.getByLabelText('Код *'), 'P-9');
    await user.type(screen.getByLabelText('Название *'), 'Нет детали');
    await user.click(createButton());
    await waitFor(() =>
      expect(mocks.dictCreate).toHaveBeenCalledWith('reasons', {
        kind: 'pause',
        code: 'P-9',
        name: 'Нет детали',
      }),
    );
    await waitFor(() => expect(screen.getByLabelText('Вид причины *')).toHaveValue('reject'));
  });

  it('retains catalog fields after server rejection and permits retry', async () => {
    mocks.dictCreate.mockRejectedValueOnce(failure('Код уже существует'));
    const user = await openTab('Участки');
    await user.type(screen.getByLabelText('Название *'), 'Цех 3');
    await user.type(screen.getByLabelText('Код *'), 'A3');
    await user.click(createButton());
    await waitFor(() => expect(mocks.dictCreate).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('status')).toHaveTextContent('Код уже существует');
    await waitFor(() => expect(createButton()).toBeEnabled());
    expect(screen.getByLabelText('Название *')).toHaveValue('Цех 3');
    await user.click(createButton());
    await waitFor(() => expect(mocks.dictCreate).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Сохранено'));
    await waitFor(() => expect(screen.getByLabelText('Название *')).toHaveValue(''));
  });

  it('shows list failure and retries to display rows with safe fallback labels', async () => {
    mocks.dictList.mockRejectedValueOnce(failure('Справочник временно недоступен'));
    mocks.dictList.mockResolvedValue([
      { id: 'named', full_name: 'Резервное имя' },
      { id: 'id-only' },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<AdminPage />);
    await screen.findByText('Справочник временно недоступен');
    await user.click(screen.getByRole('button', { name: /Повторить/ }));
    await screen.findByText('Резервное имя');
    expect(screen.getAllByText('id-only').length).toBe(2);
  });
});

describe('admin employee editing and mutation errors', () => {
  it('edits identity, role, shift, crew and removes an assigned area', async () => {
    const user = await openTab('Сотрудники');
    await user.click(screen.getByRole('button', { name: 'Изменить' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.clear(dialog.getByLabelText('Логин'));
    expect(dialog.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    await user.type(dialog.getByLabelText('Логин'), ' master3 ');
    await user.clear(dialog.getByLabelText('ФИО'));
    expect(dialog.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    await user.type(dialog.getByLabelText('ФИО'), ' Мастер Цеха ');
    await user.selectOptions(dialog.getByLabelText('Роль'), 'master');
    await user.selectOptions(dialog.getByLabelText('Смена'), 'night');
    await user.selectOptions(dialog.getByLabelText('Бригада'), '');
    await user.click(dialog.getByLabelText('Цех первый'));
    await user.click(dialog.getByLabelText('Цех второй'));
    await user.click(dialog.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(mocks.patchDict).toHaveBeenCalledWith('employees', 'worker-1', {
        login: 'master3',
        full_name: 'Мастер Цеха',
        role: 'master',
        shift: 'night',
        crew_id: null,
        area_ids: ['a2'],
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('preserves edit values after a server error and permits correcting them', async () => {
    mocks.patchDict.mockRejectedValueOnce(failure('Логин занят'));
    const user = await openTab('Сотрудники');
    await user.click(screen.getByRole('button', { name: 'Изменить' }));
    let dialog = within(screen.getByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'Сохранить' }));
    await screen.findByText('Логин занят');
    dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByLabelText('Логин')).toHaveValue('worker01');
    await user.clear(dialog.getByLabelText('Логин'));
    await user.type(dialog.getByLabelText('Логин'), 'worker02');
    await user.click(dialog.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(mocks.patchDict).toHaveBeenLastCalledWith(
        'employees',
        'worker-1',
        expect.objectContaining({ login: 'worker02', crew_id: 't1' }),
      ),
    );
  });

  it('dismisses the edit scrim and clears an outstanding delete confirmation', async () => {
    const user = await openTab('Сотрудники');
    await user.click(screen.getByRole('button', { name: 'Удалить' }));
    await user.click(screen.getByRole('button', { name: 'Изменить' }));
    expect(screen.queryByRole('button', { name: 'Точно удалить?' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('dialog').parentElement!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.patchDict).not.toHaveBeenCalled();
    expect(mocks.deleteDict).not.toHaveBeenCalled();
  });

  it('reports failed deletion without removing the row or leaving confirmation armed', async () => {
    mocks.deleteDict.mockRejectedValueOnce(failure('Есть активные наряды'));
    const user = await openTab('Сотрудники');
    await user.click(screen.getByRole('button', { name: 'Удалить' }));
    await user.click(screen.getByRole('button', { name: 'Точно удалить?' }));
    await screen.findByText('Есть активные наряды');
    expect(screen.getByText(/worker01 · Иван Петров/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Точно удалить?' })).not.toBeInTheDocument();
  });

  it('sanitizes replacement PIN and preserves it after failure for retry', async () => {
    mocks.resetPin.mockRejectedValueOnce(failure('ПИН не изменён'));
    const user = await openTab('Сотрудники');
    const input = screen.getByPlaceholderText('новый ПИН');
    await user.type(input, 'a123456789');
    expect(input).toHaveValue('12345678');
    await user.click(screen.getByRole('button', { name: 'ПИН', exact: true }));
    await screen.findByText('ПИН не изменён');
    expect(input).toHaveValue('12345678');
    await user.click(screen.getByRole('button', { name: 'ПИН', exact: true }));
    await screen.findByText('ПИН обновлён');
    expect(input).toHaveValue('');
  });

  it('reports unblock failure then success on retry', async () => {
    mocks.unblockUser.mockRejectedValueOnce(failure('Не удалось разблокировать'));
    const user = await openTab('Сотрудники');
    await user.click(screen.getByRole('button', { name: 'Разблокировать' }));
    await screen.findByText('Не удалось разблокировать');
    await user.click(screen.getByRole('button', { name: 'Разблокировать' }));
    await screen.findByText('Разблокирован');
  });

  it('keeps new employee fields after rejection, including chosen role and areas', async () => {
    mocks.createEmployee.mockRejectedValueOnce(failure('Сотрудник уже существует'));
    const user = await openTab('Сотрудники');
    await user.type(screen.getByPlaceholderText('логин (например worker16)'), ' admin2 ');
    await user.type(screen.getByPlaceholderText('ПИН 4–8 цифр'), 'a987654321');
    await user.type(screen.getByPlaceholderText('ФИО'), 'Администратор Демо');
    await user.selectOptions(screen.getByLabelText('Роль'), 'admin');
    await user.click(screen.getByLabelText('Цех первый'));
    await user.click(screen.getByLabelText('Цех второй'));
    await user.click(screen.getByLabelText('Цех первый'));
    await user.click(createButton());
    await screen.findByText('Сотрудник уже существует');
    expect(screen.getByPlaceholderText('ФИО')).toHaveValue('Администратор Демо');
    await user.click(createButton());
    await screen.findByText('Сохранено');
    expect(mocks.createEmployee).toHaveBeenLastCalledWith({
      login: 'admin2',
      pin: '98765432',
      full_name: 'Администратор Демо',
      role: 'admin',
      area_ids: ['a2'],
    });
    expect(screen.getByPlaceholderText('ФИО')).toHaveValue('');
    expect(screen.getByLabelText('Цех второй')).not.toBeChecked();
  });
});

describe('Excel import', () => {
  async function openImport(name = 'Оборудование') {
    const user = await openTab(name);
    const file = new File(['synthetic spreadsheet'], 'catalog.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    expect(screen.getByRole('button', { name: 'Проверить', exact: true })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Импортировать', exact: true })).toBeDisabled();
    await user.upload(screen.getByLabelText('Excel-файл (.xlsx)'), file);
    return { user, file };
  }

  it('previews at most five rows, surfaces validation errors, and sends dry-run multipart', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      data: {
        rows: Array.from({ length: 6 }, (_, i) => ({
          inventory_no: `TEST-${i}`,
          name: i === 0 ? null : `Объект ${i}`,
        })),
        errors: [{ row: 2, path: 'name', message: 'Название обязательно' }],
      },
    });
    const { user, file } = await openImport();
    await user.click(screen.getByRole('button', { name: 'Проверить', exact: true }));
    await screen.findByText(/Предпросмотр · Строк: 6/);
    expect(screen.getByText('TEST-4')).toBeInTheDocument();
    expect(screen.queryByText('TEST-5')).not.toBeInTheDocument();
    expect(screen.getByText('Строка 2: name — Название обязательно')).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/dict/equipment/import', expect.any(FormData), {
      params: { dry_run: true },
    });
    expect((post.mock.calls[0][1] as FormData).get('file')).toMatchObject({
      name: file.name,
      size: file.size,
      type: file.type,
    });
  });

  it('requires explicit confirmation and shows created/updated counts', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { created: '2', updated: 3 } });
    const { user } = await openImport('Материалы');
    await user.click(screen.getByRole('button', { name: 'Импортировать', exact: true }));
    expect(post).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Точно импортировать?' }));
    await screen.findByText('Создано: 2, обновлено: 3');
    expect(post).toHaveBeenCalledWith('/dict/materials/import', expect.any(FormData), {
      params: { dry_run: false },
    });
    expect(screen.queryByRole('button', { name: 'Точно импортировать?' })).not.toBeInTheDocument();
  });

  it('filters malformed row errors and retains a valid row error on import failure', async () => {
    vi.spyOn(api, 'post').mockRejectedValueOnce(
      failure('Импорт отклонён', [
        null,
        false,
        'bad',
        { row: '3' },
        { row: 3, path: 'area_id', message: 'Участок не найден' },
      ]),
    );
    const { user } = await openImport();
    await user.click(screen.getByRole('button', { name: 'Импортировать', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Точно импортировать?' }));
    await screen.findByText('Импорт отклонён');
    expect(screen.getByText('Строка 3: area_id — Участок не найден')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Импортировать', exact: true })).toBeEnabled();
  });

  it.each([new Error('offline'), { response: {} }, failure('Ошибка таблицы', { row: 3 })])(
    'recovers dry-run errors without structured rows (%#)',
    async (error) => {
      const post = vi
        .spyOn(api, 'post')
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ data: {} });
      const { user } = await openImport();
      await user.click(screen.getByRole('button', { name: 'Проверить', exact: true }));
      await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Проверить', exact: true })).toBeEnabled(),
      );
      expect(screen.queryByText('Ошибки')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Проверить', exact: true }));
      await screen.findByText(/Предпросмотр · Строк: 0/);
    },
  );

  it('clears preview, confirmation and result when the file is deselected', async () => {
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValueOnce({ data: { rows: [{ name: 'Запчасть' }], errors: [] } })
      .mockResolvedValueOnce({ data: {} });
    const { user } = await openImport();
    await user.click(screen.getByRole('button', { name: 'Проверить', exact: true }));
    await screen.findByText('Запчасть');
    await user.click(screen.getByRole('button', { name: 'Импортировать', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Точно импортировать?' }));
    await screen.findByText('Создано: 0, обновлено: 0');
    fireEvent.change(screen.getByLabelText('Excel-файл (.xlsx)'), { target: { files: [] } });
    await screen.findByText('Выберите .xlsx-файл');
    expect(screen.queryByText('Запчасть')).not.toBeInTheDocument();
    expect(screen.queryByText('Создано: 0, обновлено: 0')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Импортировать', exact: true })).toBeDisabled();
    expect(post).toHaveBeenCalledTimes(2);
  });
});
