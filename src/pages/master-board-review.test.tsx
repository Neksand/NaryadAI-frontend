// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import MasterBoard from './MasterBoard';
import MasterReview from './MasterReview';
import { testQueryClient } from '../test-utils';
import '../i18n/config';
import type { WorkOrder } from '../types/domain';

const woMocks = vi.hoisted(() => ({
  listWorkOrders: vi.fn(),
  getWorkOrder: vi.fn(),
  reviewDecision: vi.fn(async () => ({})),
  transitionOrder: vi.fn(async () => ({})),
}));
const inspectionMock = vi.hoisted(() => vi.fn());

vi.mock('../api/workOrders', () => woMocks);
vi.mock('../api/ai', () => ({ getInspection: inspectionMock }));
vi.mock('../hooks/useWS', () => ({
  useRealtime: () => ({ status: 'closed', reconnected: false }),
}));
vi.mock('../lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api-client')>();
  return {
    ...actual,
    api: { get: vi.fn(async () => []), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const mk = (id: string, status: WorkOrder['status']): WorkOrder => ({
  id,
  status,
  priority: 'normal',
  description: `Наряд ${id}`,
  allowed_actions: [],
});

function renderAt(path: string, route: string, element: React.ReactNode) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={testQueryClient()}>
        <Routes>
          <Route path={route} element={element} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('MasterBoard', () => {
  it('groups orders by status columns', async () => {
    woMocks.listWorkOrders.mockResolvedValue({
      items: [mk('a', 'issued'), mk('b', 'in_progress'), mk('c', 'ai_review')],
      next_cursor: null,
    });
    renderAt('/master/board', '/master/board', <MasterBoard />);
    await waitFor(() => expect(screen.getByText('Наряд a')).toBeTruthy());
    expect(screen.getByText('Наряд b')).toBeTruthy();
    expect(screen.getByText('Наряд c')).toBeTruthy();
    expect(screen.getByText(/Выдан \(1\)/)).toBeTruthy();
  });

  it('collapses columns and persists state', async () => {
    const u = userEvent.setup();
    woMocks.listWorkOrders.mockResolvedValue({ items: [mk('a', 'issued')], next_cursor: null });
    renderAt('/master/board', '/master/board', <MasterBoard />);
    await waitFor(() => expect(screen.getByText('Наряд a')).toBeTruthy());
    await u.click(screen.getByRole('button', { name: /Выдан \(1\)/ }));
    expect(screen.queryByText('Наряд a')).toBeNull();
    expect(localStorage.getItem('naryadai.board-open')).toContain('issued');
  });

  it('filters by status select', async () => {
    const u = userEvent.setup();
    woMocks.listWorkOrders.mockResolvedValue({ items: [], next_cursor: null });
    renderAt('/master/board', '/master/board', <MasterBoard />);
    await waitFor(() => expect(screen.getByText(/Выдан \(0\)/)).toBeTruthy());
    await u.selectOptions(screen.getByLabelText('Наряды'), 'in_progress');
    await waitFor(() =>
      expect(woMocks.listWorkOrders).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'in_progress' }),
      ),
    );
  });
});

describe('MasterReview', () => {
  const order: WorkOrder = {
    id: 'o1',
    number: 3,
    status: 'ai_review',
    priority: 'high',
    description: 'Ремонт',
    allowed_actions: ['close'],
  };

  function renderReview() {
    woMocks.getWorkOrder.mockResolvedValue(order);
    inspectionMock.mockResolvedValue({
      verdict: 'accepted',
      score: 85,
      confidence: 0.9,
      explanation: 'Всё чисто',
    });
    renderAt('/master/review/o1', '/master/review/:id', <MasterReview />);
  }

  it('agrees with AI review', async () => {
    const u = userEvent.setup();
    renderReview();
    await waitFor(() => expect(screen.getByText('Всё чисто')).toBeTruthy());
    expect(screen.getByText('Принято')).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Согласен — закрыть' }));
    await waitFor(() =>
      expect(woMocks.reviewDecision).toHaveBeenCalledWith(
        'o1',
        'agree_ai',
        undefined,
        undefined,
        expect.any(String),
      ),
    );
  });

  it('requires comment for rework', async () => {
    const u = userEvent.setup();
    renderReview();
    await waitFor(() => expect(screen.getByText('Всё чисто')).toBeTruthy());
    const rework = screen.getByRole('button', { name: 'Вернуть на доработку' });
    expect((rework as HTMLButtonElement).disabled).toBe(true);
    await u.type(screen.getByPlaceholderText('Для доработки нужен комментарий'), 'Фото смазано');
    expect((rework as HTMLButtonElement).disabled).toBe(false);
    await u.click(rework);
    await waitFor(() =>
      expect(woMocks.transitionOrder).toHaveBeenCalledWith(
        'o1',
        'return_to_rework',
        { comment: 'Фото смазано' },
        expect.any(String),
      ),
    );
  });

  it('shows pending banner when review is not ready', async () => {
    woMocks.getWorkOrder.mockResolvedValue(order);
    inspectionMock.mockRejectedValue(new Error('pending'));
    renderAt('/master/review/o1', '/master/review/:id', <MasterReview />);
    await waitFor(() => expect(screen.getByText('ИИ-проверка ещё идёт, подождите…')).toBeTruthy(), {
      timeout: 4000,
    });
  });
});
