// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { AITag, EmptyState, ErrorState, OrderCard, PriorityTag, StatusChip } from './ui';
import type { WorkOrder } from '../types/domain';

vi.mock('../lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api-client')>();
  const empty = vi.fn(async () => []);
  return { ...actual, api: { get: empty, post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

const order: WorkOrder = {
  id: 'o1',
  number: 42,
  status: 'in_progress',
  priority: 'critical',
  description: 'Гул редуктора на второй линии',
  equipment_id: 'e1',
  area_id: 'a1',
  assignee_id: 'w1',
  due_at: '2026-10-12T09:05:00',
  allowed_actions: ['pause', 'complete'],
};

describe('StatusChip', () => {
  it.each([
    ['issued', 'info'],
    ['accepted', 'brand'],
    ['queued', 'info'],
    ['rejected', 'danger'],
    ['in_progress', 'warn'],
    ['paused', 'neutral'],
    ['rework', 'danger'],
    ['done', 'ok'],
    ['ai_review', 'ai'],
    ['closed', 'ok'],
    ['cancelled', 'neutral'],
  ] as const)('status %s uses tone %s', (status, tone) => {
    const { unmount } = renderWithProviders(<StatusChip status={status} />);
    expect(document.querySelector(`.chip.${tone}`)).toBeTruthy();
    unmount();
  });

  it('shows overdue badge with clock icon', () => {
    renderWithProviders(<StatusChip status="issued" overdue />);
    expect(screen.getByText('Просрочен')).toBeTruthy();
    expect(document.querySelector('.chip.danger svg')).toBeTruthy();
  });
});

describe('PriorityTag', () => {
  it.each(['critical', 'high', 'normal', 'planned'] as const)('renders %s tag', (p) => {
    const { unmount } = renderWithProviders(<PriorityTag priority={p} />);
    expect(document.querySelector(`.prio.${p}`)).toBeTruthy();
    unmount();
  });
});

describe('OrderCard', () => {
  it('renders number, priority rail and link', () => {
    renderWithProviders(<OrderCard order={order} to="/worker/orders/o1" />);
    expect(screen.getByText(/№42/)).toBeTruthy();
    expect(screen.getByText('Гул редуктора на второй линии')).toBeTruthy();
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/worker/orders/o1');
    expect(link.className).toContain('orail');
    expect(link.className).toContain('critical');
  });

  it('falls back to short id without number', () => {
    renderWithProviders(<OrderCard order={{ ...order, number: null }} to="/x" />);
    expect(screen.getByText(/№o1/)).toBeTruthy();
  });
});

describe('states', () => {
  it('ErrorState calls retry', async () => {
    const onRetry = vi.fn();
    const { getByRole } = renderWithProviders(<ErrorState message="Упало" onRetry={onRetry} />);
    expect(getByRole('alert').textContent).toContain('Упало');
    getByRole('button').click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('EmptyState renders status text', () => {
    renderWithProviders(<EmptyState text="Пока пусто" />);
    expect(screen.getByRole('status').textContent).toBe('Пока пусто');
  });

  it('AITag shows confidence percent and hides empty explanation', () => {
    const { rerender } = renderWithProviders(
      <AITag confidence={0.856} explanation="Заменить подшипник" />,
    );
    expect(screen.getByText(/86 %/)).toBeTruthy();
    expect(screen.getByText('Заменить подшипник')).toBeTruthy();
    rerender(<AITag />);
    expect(screen.queryByText(/%/)).toBeNull();
  });
});
