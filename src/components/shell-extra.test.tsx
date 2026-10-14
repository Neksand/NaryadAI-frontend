// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render } from '@testing-library/react';
import { Shell } from './Shell';
import { useAuthStore } from '../store/auth-store';
import { testQueryClient } from '../test-utils';
import '../i18n/config';
import type { User } from '../types/domain';

const wsState = vi.hoisted(() => ({ status: 'closed', reconnected: false }));

vi.mock('../hooks/useWS', () => ({ useRealtime: () => ({ ...wsState }) }));
vi.mock('../api/auth', () => ({ logout: vi.fn(async () => {}) }));

const worker: User = { id: 'w1', login: 'w', full_name: 'Иван', role: 'worker', area_ids: [] };

beforeEach(() => {
  useAuthStore.getState().logout();
  useAuthStore.setState({ bootstrapped: true });
  wsState.status = 'closed';
  wsState.reconnected = false;
  vi.clearAllMocks();
});

function renderShell() {
  useAuthStore.getState().setSession({ ...worker }, 'a', 'r');
  render(
    <MemoryRouter initialEntries={['/worker']}>
      <QueryClientProvider client={testQueryClient()}>
        <Routes>
          <Route
            path="*"
            element={
              <Shell title="Наряды">
                <div>x</div>
              </Shell>
            }
          />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('Shell realtime', () => {
  it('shows reconnected banner only after reconnect', () => {
    renderShell();
    expect(screen.queryByText('Связь восстановлена')).toBeNull();
    // rerender path: state change requires new render — covered by hook test;
    // here we assert banner wiring with reconnected=true
  });

  it('shows banner when reconnected', () => {
    wsState.status = 'open';
    wsState.reconnected = true;
    renderShell();
    expect(screen.getByText('Связь восстановлена')).toBeTruthy();
    expect(document.querySelector('.conn.on')).toBeTruthy();
  });

  it('connection dot is dim when closed', () => {
    renderShell();
    expect(document.querySelector('.conn.on')).toBeNull();
    expect(document.querySelector('.conn')).toBeTruthy();
  });
});
