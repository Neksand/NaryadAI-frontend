// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeadlineTimer, WorkerOrderCard } from './WorkerOrderCard';
import { renderWithProviders } from '../test-utils';
import type { WorkOrder } from '../types/domain';

vi.mock('../hooks/useNames', () => ({
  useNames: () => ({ areas: new Map(), equipment: new Map(), users: new Map() }),
  displayOrder: (order: WorkOrder) => order,
}));

const orderFor = (action: string): WorkOrder => ({
  id: 'order-123',
  number: 123,
  status: 'issued',
  priority: 'high',
  description: 'Подшипник перегревается',
  allowed_actions: action ? [action] : [],
  equipment_name: 'Насос',
  due_at: '2026-10-13T13:00:00Z',
});

describe('WorkerOrderCard next-step controls', () => {
  it.each([
    ['accept', 'Принять в работу', true],
    ['queue', 'В очередь', true],
    ['start', 'Начать', true],
    ['resume', 'Продолжить', true],
    ['complete', 'Завершить', false],
    ['cancel', 'Отменить', false],
    ['close', 'Закрыть', false],
    ['', 'Открыть наряд', false],
  ])('shows the next step %s with the correct interaction', async (action, label, quick) => {
    const onQuickAction = vi.fn();
    renderWithProviders(<WorkerOrderCard order={orderFor(action)} onQuickAction={onQuickAction} />);

    if (quick) {
      await userEvent.setup().click(screen.getByRole('button', { name: label }));
      expect(onQuickAction).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'order-123' }),
        action,
      );
    } else {
      expect(screen.getByRole('link', { name: label })).toHaveAttribute(
        'href',
        '/worker/orders/order-123',
      );
      expect(onQuickAction).not.toHaveBeenCalled();
    }
  });

  it('disables a queued or in-flight quick action so a worker cannot double-submit', () => {
    const item = orderFor('accept');
    const onQuickAction = vi.fn();
    renderWithProviders(<WorkerOrderCard order={item} onQuickAction={onQuickAction} queued />);
    expect(screen.getByRole('button', { name: 'в очереди' })).toBeDisabled();
    cleanup();
    renderWithProviders(
      <WorkerOrderCard order={item} onQuickAction={onQuickAction} quickActionPending />,
    );
    expect(screen.getByRole('button', { name: 'Принять в работу' })).toBeDisabled();
  });
});

describe('DeadlineTimer live update', () => {
  afterEach(() => vi.useRealTimers());

  it('changes the same card from time remaining to overdue as the clock advances', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-13T12:00:30Z'));
    renderWithProviders(<DeadlineTimer dueAt="2026-10-13T12:01:00Z" />);
    expect(screen.getByLabelText('До срока 1 мин')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(45_000);
    });

    expect(screen.getByLabelText('Просрочка 1 мин')).toBeInTheDocument();
  });
});
