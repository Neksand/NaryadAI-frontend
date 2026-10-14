// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render } from '@testing-library/react';
import { AxiosError } from 'axios';
import LoginPage from '../pages/Login';
import { useAuthStore } from '../store/auth-store';
import { testQueryClient } from '../test-utils';
import '../i18n/config';

const loginMock = vi.hoisted(() => vi.fn());
vi.mock('../api/auth', () => ({ login: loginMock }));

const user = { id: 'u1', login: 'worker01', full_name: 'Работник', role: 'worker', area_ids: [] };

function renderLogin() {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <QueryClientProvider client={testQueryClient()}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/worker" element={<div>WORKER_HOME</div>} />
          <Route path="/master" element={<div>MASTER_HOME</div>} />
          <Route path="/manager" element={<div>MANAGER_HOME</div>} />
          <Route path="/admin" element={<div>ADMIN_HOME</div>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAuthStore.getState().logout();
  vi.clearAllMocks();
});

describe('LoginPage form', () => {
  it('disables submit until login and 4-digit pin', async () => {
    const u = userEvent.setup();
    renderLogin();
    const submit = screen.getByRole('button', { name: 'Войти' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await u.type(screen.getByLabelText('Логин'), 'worker01');
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await u.type(screen.getByLabelText('ПИН'), '1001');
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps only digits in pin, max 8', async () => {
    const u = userEvent.setup();
    renderLogin();
    const pin = screen.getByLabelText('ПИН') as HTMLInputElement;
    await u.type(pin, 'ab12cd34567890');
    expect(pin.value).toBe('12345678');
  });

  it('logs in and navigates to role home', async () => {
    const u = userEvent.setup();
    loginMock.mockResolvedValueOnce({ user, access: 'a', refresh: 'r' });
    renderLogin();
    await u.type(screen.getByLabelText('Логин'), 'worker01');
    await u.type(screen.getByLabelText('ПИН'), '1001');
    await u.click(screen.getByRole('button', { name: 'Войти' }));
    await waitFor(() => expect(screen.getByText('WORKER_HOME')).toBeTruthy());
    expect(loginMock).toHaveBeenCalledWith('worker01', '1001');
    expect(useAuthStore.getState().user?.id).toBe('u1');
  });

  it('shows friendly error on 401', async () => {
    const u = userEvent.setup();
    loginMock.mockRejectedValueOnce(
      new AxiosError('x', undefined, undefined, undefined, {
        status: 401,
        data: { error: { code: 'unauthorized', message: 'bad' } },
      } as never),
    );
    renderLogin();
    await u.type(screen.getByLabelText('Логин'), 'bad');
    await u.type(screen.getByLabelText('ПИН'), '0000');
    await u.click(screen.getByRole('button', { name: 'Войти' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('Неверный логин');
  });
});

describe('LoginPage demo panel', () => {
  it.each([
    ['Исполнитель', 'worker', 'worker01', '1001', 'WORKER_HOME'],
    ['Мастер', 'master', 'master1', '3333', 'MASTER_HOME'],
    ['Руководитель', 'manager', 'manager1', '2222', 'MANAGER_HOME'],
    ['Администратор', 'admin', 'admin', '1234', 'ADMIN_HOME'],
  ])(
    'demo %s authenticates against the local API and opens %s',
    async (label, role, loginName, pin, home) => {
      const u = userEvent.setup();
      loginMock.mockResolvedValueOnce({
        user: { ...user, role },
        access: 'access',
        refresh: 'refresh',
      });
      renderLogin();
      await u.click(screen.getByRole('button', { name: label }));
      await waitFor(() => expect(screen.getByText(home)).toBeTruthy());
      expect(loginMock).toHaveBeenCalledWith(loginName, pin);
      expect(useAuthStore.getState().user?.role).toBe(role);
    },
  );
});
