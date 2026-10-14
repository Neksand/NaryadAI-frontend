// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useNames } from './useNames';
import i18n from '../i18n/config';

const catalogMock = vi.hoisted(() => vi.fn(async () => []));
const workersGetMock = vi.hoisted(() => vi.fn(async () => ({ data: [] })));

vi.mock('../api/misc', () => ({ catalogList: catalogMock }));
vi.mock('../lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api-client')>();
  return {
    ...actual,
    api: { get: workersGetMock, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  void i18n.changeLanguage('ru');
  catalogMock.mockImplementation(async (name: string) => {
    if (name === 'sites') return [{ id: 'a1', name: 'Участок', name_kk: 'Учаске' }];
    if (name === 'equipment') return [{ id: 'e1', name: 'Насос', name_kk: 'Сорғы' }];
    return [];
  });
  workersGetMock.mockResolvedValue({ data: [{ id: 'w1', full_name: 'Иван' }] });
});

describe('useNames', () => {
  it('builds maps from catalogs', async () => {
    const { result } = renderHook(() => useNames(), { wrapper });
    await waitFor(() => expect(result.current.areas.get('a1')).toBe('Участок'));
    expect(result.current.equipment.get('e1')).toBe('Насос');
    expect(result.current.users.get('w1')).toBe('Иван');
  });

  it('uses kk names when language is kk', async () => {
    await i18n.changeLanguage('kk');
    const { result } = renderHook(() => useNames(), { wrapper });
    await waitFor(() => expect(result.current.areas.get('a1')).toBe('Учаске'));
    expect(result.current.equipment.get('e1')).toBe('Сорғы');
  });

  it('returns empty maps on empty catalogs', async () => {
    catalogMock.mockResolvedValue([]);
    workersGetMock.mockResolvedValue({ data: [] });
    const { result } = renderHook(() => useNames(), { wrapper });
    await waitFor(() => expect(catalogMock).toHaveBeenCalled());
    expect(result.current.areas.size).toBe(0);
    expect(result.current.users.size).toBe(0);
  });

  it('survives workers fetch failure', async () => {
    workersGetMock.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useNames(), { wrapper });
    await waitFor(() => expect(result.current.areas.get('a1')).toBe('Участок'));
    expect(result.current.users.size).toBe(0);
  });
});
