// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { cleanup, render } from '@testing-library/react';
import { Shell } from './Shell';
import { useAuthStore } from '../store/auth-store';
import type { User } from '../types/domain';
import { testQueryClient } from '../test-utils';
import '../i18n/config';

vi.mock('../hooks/useWS', () => ({
  useRealtime: () => ({ status: 'closed', reconnected: false }),
}));

const logoutMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../api/auth', () => ({ logout: logoutMock }));

const worker: User = {
  id: 'w1',
  login: 'worker',
  full_name: 'Иванов Иван',
  role: 'worker',
  area_ids: [],
};

function renderShell(route: string, title = 'Наряды') {
  render(
    <MemoryRouter initialEntries={[route]}>
      <QueryClientProvider client={testQueryClient()}>
        <Routes>
          <Route path="/login" element={<div>LOGIN_PAGE</div>} />
          <Route
            path="*"
            element={
              <Shell title={title}>
                <div>content</div>
              </Shell>
            }
          />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAuthStore.getState().logout();
  useAuthStore.setState({ bootstrapped: true });
  vi.clearAllMocks();
  localStorage.clear();
});

describe('Shell header', () => {
  it('shows user, role chip and logout', async () => {
    useAuthStore.getState().setSession({ ...worker }, 'a', 'r');
    renderShell('/worker');
    expect(screen.getByText('Иванов Иван')).toBeTruthy();
    expect(screen.getByText('Исполнитель')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Выйти' })).toBeTruthy();
  });

  it('hides back button on home, shows it inside', () => {
    useAuthStore.getState().setSession({ ...worker }, 'a', 'r');
    renderShell('/worker');
    expect(screen.queryByRole('button', { name: 'Назад' })).toBeNull();
    cleanup();
    renderShell('/worker/orders/o1');
    expect(screen.getByRole('button', { name: 'Назад' })).toBeTruthy();
  });

  it('logout clears session and goes to /login', async () => {
    const user = userEvent.setup();
    useAuthStore.getState().setSession({ ...worker }, 'a', 'r');
    renderShell('/worker');
    await user.click(screen.getByRole('button', { name: 'Выйти' }));
    await waitFor(() => expect(screen.getByText('LOGIN_PAGE')).toBeTruthy());
    expect(useAuthStore.getState().user).toBeNull();
    expect(logoutMock).toHaveBeenCalled();
  });
});

describe('Shell tabs', () => {
  it('highlights active tab and shows badges', () => {
    useAuthStore.setState({
      user: { ...worker },
      role: 'worker',
      accessToken: 'a',
      bootstrapped: true,
    });
    renderShell('/notifications', 'Уведомления');
    const active = screen.getByRole('link', { current: 'page' });
    expect(active.textContent).toContain('Уведомления');
    expect(screen.getByRole('navigation').querySelectorAll('a')).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'Профиль' })).toHaveAttribute(
      'href',
      '/worker/profile',
    );
  });

  it('switches language and persists choice', async () => {
    const user = userEvent.setup();
    useAuthStore.getState().setSession({ ...worker }, 'a', 'r');
    renderShell('/worker');
    const select = screen.getByLabelText('language / тіл') as HTMLSelectElement;
    await user.selectOptions(select, 'kk');
    expect(localStorage.getItem('naryadai.lang')).toBe('kk');
    await user.selectOptions(select, 'ru');
  });
});
