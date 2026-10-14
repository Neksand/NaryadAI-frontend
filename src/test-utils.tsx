// @vitest-environment jsdom
import './i18n/config';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

export function testQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

export function renderWithProviders(ui: ReactElement, opts?: RenderOptions & { route?: string }) {
  const { route = '/', ...rest } = opts ?? {};
  return render(
    <MemoryRouter initialEntries={[route]}>
      <QueryClientProvider client={testQueryClient()}>{ui}</QueryClientProvider>
    </MemoryRouter>,
    rest,
  );
}
