// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import EquipmentPage from './Equipment';
import { testQueryClient } from '../test-utils';
import { useAuthStore } from '../store/auth-store';
import '../i18n/config';

const miscMocks = vi.hoisted(() => ({
  catalogList: vi.fn(async (_name: string): Promise<unknown[]> => []),
}));

const woMocks = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getEquipmentHistory: vi.fn(async (_id: string): Promise<any[]> => []),
}));

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('../api/misc', () => miscMocks);
vi.mock('../api/workOrders', () => woMocks);
vi.mock('../lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api-client')>();
  return {
    ...actual,
    api: { get: apiMocks.get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});
vi.mock('../hooks/useWS', () => ({
  useRealtime: () => ({ status: 'closed', reconnected: false }),
}));

const EQ = {
  id: 'e1',
  name: 'Конвейер К-3',
  name_kk: 'К-3 конвейері',
  inventory_no: 'EQ-0001',
  area_id: 'a1',
  type: 'конвейер',
  criticality: 'A',
  qr_token: 'NAR-00001',
};
const SITES = [{ id: 'a1', name: 'Дробление', name_kk: 'Ұсақтау' }];

function loginAs(role: 'master' | 'manager' | 'admin' | 'worker') {
  useAuthStore.getState().setSession(
    {
      id: `${role}-1`,
      login: `${role}1`,
      full_name: `Тест ${role}`,
      role,
      area_ids: [],
    },
    'access',
    'refresh',
  );
}

function renderEquipment(entry = '/equipment/e1') {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <QueryClientProvider client={testQueryClient()}>
        <Routes>
          <Route path="/equipment/:id" element={<EquipmentPage />} />
          <Route path="/equipment/:id/" element={<EquipmentPage />} />
          <Route path="/worker" element={<div>WORKER_HOME</div>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().logout();
  loginAs('master');
  miscMocks.catalogList.mockImplementation(async (name: string) => {
    if (name === 'equipment') return [EQ];
    if (name === 'sites') return SITES;
    return [];
  });
  woMocks.getEquipmentHistory.mockResolvedValue([]);
});

describe('EquipmentPage', () => {
  it('показывает карточку: название, инв-номер, участок, тип, критичность', async () => {
    renderEquipment();
    await waitFor(() => expect(screen.getByText('EQ-0001')).toBeTruthy());
    // Название — и в шапке Shell, и в карточке.
    expect(screen.getAllByText('Конвейер К-3').length).toBeGreaterThan(0);
    expect(screen.getByText('Дробление')).toBeTruthy();
    expect(screen.getByText('конвейер')).toBeTruthy();
    expect(woMocks.getEquipmentHistory).toHaveBeenCalledWith('e1');
  });

  it('пустая история показывает заглушку', async () => {
    woMocks.getEquipmentHistory.mockResolvedValueOnce([]);
    renderEquipment();
    await waitFor(() =>
      expect(screen.getByText('По этому оборудованию ещё нет нарядов.')).toBeTruthy(),
    );
  });

  it('показывает записи истории ремонтов', async () => {
    woMocks.getEquipmentHistory.mockResolvedValueOnce([
      {
        id: 'o9',
        number: 9,
        status: 'closed',
        issued_at: '2026-09-20T08:00:00Z',
        fault_name: 'Износ подшипника',
        description: 'Шум при работе',
        work_done_text: 'Подшипник заменён',
      },
    ]);
    renderEquipment();
    await waitFor(() => expect(screen.getByText('Наряд №9')).toBeTruthy());
    // Строка истории: «Что сделали: <текст>» — матчим подстрокой.
    expect(screen.getByText(/Подшипник заменён/)).toBeTruthy();
  });

  it('невалидный QR-токен показывает ошибку', async () => {
    const u = userEvent.setup();
    apiMocks.get.mockRejectedValueOnce(new Error('not found'));
    renderEquipment();
    await waitFor(() => expect(screen.getByText('EQ-0001')).toBeTruthy());
    await u.type(screen.getByLabelText('QR-токен'), 'NOPE-XXXX');
    await u.click(screen.getByRole('button', { name: 'Найти' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(apiMocks.get).toHaveBeenCalledWith('/equipment/by-qr/NOPE-XXXX');
  });

  it('worker редиректится на /worker', async () => {
    loginAs('worker');
    renderEquipment();
    await waitFor(() => expect(screen.getByText('WORKER_HOME')).toBeTruthy());
  });
});
