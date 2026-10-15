// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import {
  CrewLoad,
  crewStatusTone,
  findCurrentOrder,
  groupByCrew,
  normalizeWorkerStatus,
  orderLabel,
  type CrewMember,
  type WorkOrder,
} from './CrewLoad';
import { renderWithProviders } from '../test-utils';
import i18n from '../i18n/config';
import ru from '../i18n/ru';
import kk from '../i18n/kk';

const workers: CrewMember[] = [
  { id: 'w1', full_name: 'Иван Петров', current_status: 'free', crew_id: 'c1' },
  { id: 'w2', full_name: 'Ерлан Сериков', current_status: 'busy', crew_id: 'c1' },
  { id: 'w3', full_name: 'Анна Ли', current_status: 'queue', crew_id: 'c2' },
  { id: 'w4', full_name: 'Олег Ким', current_status: 'off' },
];
const crews = [
  { id: 'c1', name: 'Бригада 1' },
  { id: 'c2', name: 'Бригада 2' },
];
const orders = [
  {
    id: 'o1',
    number: 101,
    status: 'in_progress',
    priority: 'high',
    description: 'Течь масла в насосе',
    assignee_id: 'w2',
    equipment_name: 'Насос 1',
    allowed_actions: [],
  },
  {
    id: 'o2',
    number: 102,
    status: 'closed',
    priority: 'normal',
    description: 'Старый наряд',
    assignee_id: 'w1',
    allowed_actions: [],
  },
] as unknown as WorkOrder[];

describe('normalizeWorkerStatus', () => {
  it.each([
    ['free', 'free'],
    ['busy', 'busy'],
    ['queue', 'queue'],
    ['off', 'off'],
    [' FREE ', 'free'],
    ['Busy', 'busy'],
    ['unknown-status', 'unknown'],
    [null, 'unknown'],
    [undefined, 'unknown'],
    ['', 'unknown'],
  ])('maps %s → %s', (raw, expected) => {
    expect(normalizeWorkerStatus(raw)).toBe(expected);
  });
});

describe('crewStatusTone', () => {
  it.each([
    ['free', 'ok'],
    ['busy', 'danger'],
    ['queue', 'warn'],
    ['off', 'neutral'],
    ['unknown', 'neutral'],
  ])('%s → %s', (status, tone) => {
    expect(crewStatusTone(status as never)).toBe(tone);
  });

  it('paints free green and busy red', () => {
    expect(crewStatusTone('free')).toBe('ok');
    expect(crewStatusTone('busy')).toBe('danger');
  });
});

describe('groupByCrew', () => {
  it('groups members under their crews and the unassigned tail', () => {
    const groups = groupByCrew(workers, crews);
    expect(groups[0].crew?.id).toBe('c1');
    expect(groups[0].members.map((m) => m.id)).toEqual(['w1', 'w2']);
    expect(groups[1].crew?.id).toBe('c2');
    expect(groups[1].members.map((m) => m.id)).toEqual(['w3']);
    expect(groups.at(-1)?.crew).toBeNull();
    expect(groups.at(-1)?.members.map((m) => m.id)).toEqual(['w4']);
  });

  it('keeps crews referenced only by workers', () => {
    const groups = groupByCrew([{ id: 'w9', crew_id: 'ghost' }], []);
    expect(groups).toHaveLength(1);
    expect(groups[0].crew?.id).toBe('ghost');
  });
});

describe('findCurrentOrder', () => {
  it('prefers the personal active order and ignores terminal ones', () => {
    expect(findCurrentOrder({ id: 'w2', crew_id: 'c1' }, orders)?.id).toBe('o1');
    // w1 has only a closed order → no current order
    expect(findCurrentOrder({ id: 'w1', crew_id: 'c1' }, orders)).toBeUndefined();
  });

  it('falls back to the crew order', () => {
    const crewOrders = [
      {
        id: 'o3',
        number: 103,
        status: 'accepted',
        priority: 'high',
        description: 'x',
        crew_id: 'c2',
        allowed_actions: [],
      },
    ] as unknown as WorkOrder[];
    expect(findCurrentOrder({ id: 'w3', crew_id: 'c2' }, crewOrders)?.id).toBe('o3');
  });

  it('labels the order with number and equipment', () => {
    expect(orderLabel(orders[0])).toBe('№101 · Насос 1');
  });
});

describe('CrewLoad render', () => {
  it('renders crew rows with green ready badges and a red busy link', async () => {
    await i18n.changeLanguage('ru');
    renderWithProviders(<CrewLoad workers={workers} crews={crews} orders={orders} />);

    expect(screen.getByText('Бригада 1')).toBeTruthy();
    expect(screen.getByText('Бригада 2')).toBeTruthy();
    expect(screen.getByText('Иван Петров')).toBeTruthy();

    // free → green "Готов"
    const ready = screen.getByText('Готов');
    expect(ready.className).toContain('ok');
    expect(screen.getByTestId('crewload-dot-w1').getAttribute('data-tone')).toBe('ok');

    // busy → red badge + order link
    const busy = screen.getByText('Занят');
    expect(busy.className).toContain('danger');
    expect(screen.getByTestId('crewload-dot-w2').getAttribute('data-tone')).toBe('danger');
    const link = screen.getByRole('link', { name: /Наряд 101/ });
    expect(link.getAttribute('href')).toBe('/master/orders/o1');
    expect(link).toHaveTextContent('№101 · Насос 1');

    // queue/off tones
    expect(screen.getByTestId('crewload-dot-w3').getAttribute('data-tone')).toBe('warn');
    expect(screen.getByTestId('crewload-dot-w4').getAttribute('data-tone')).toBe('neutral');

    // summary + unassigned group
    expect(screen.getByText('Свободно 1 из 2')).toBeTruthy();
    expect(screen.getByText('Без бригады')).toBeTruthy();
  });

  it('shows empty state without members', async () => {
    await i18n.changeLanguage('ru');
    renderWithProviders(<CrewLoad workers={[]} crews={[]} orders={[]} />);
    expect(screen.getByText('Нет данных о занятости')).toBeTruthy();
  });
});

describe('crewload i18n parity', () => {
  it('has identical crewload key sets in ru and kk', () => {
    const ruKeys = Object.keys(
      (ru as Record<string, unknown>).crewload as Record<string, unknown>,
    ).sort();
    const kkKeys = Object.keys(
      (kk as Record<string, unknown>).crewload as Record<string, unknown>,
    ).sort();
    expect(ruKeys.length).toBeGreaterThan(0);
    expect(kkKeys).toEqual(ruKeys);
    for (const k of ruKeys) {
      expect(typeof (ru.crewload as Record<string, unknown>)[k]).toBe('string');
      expect(((kk.crewload as Record<string, unknown>)[k] as string).length).toBeGreaterThan(0);
    }
  });
});
