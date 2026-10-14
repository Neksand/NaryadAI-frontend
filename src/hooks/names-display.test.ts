import { describe, expect, it } from 'vitest';
import { displayOrder, type NameMaps } from './useNames';
import type { WorkOrder } from '../types/domain';

const base: WorkOrder = {
  id: 'o1',
  status: 'in_progress',
  priority: 'high',
  description: 'Гул редуктора',
  equipment_id: 'e1',
  area_id: 'a1',
  assignee_id: 'w1',
  allowed_actions: [],
};

const names: NameMaps = {
  areas: new Map([['a1', 'Участок 1']]),
  equipment: new Map([['e1', 'Насос Н-1']]),
  users: new Map([['w1', 'Иванов И.']]),
};
const empty: NameMaps = { areas: new Map(), equipment: new Map(), users: new Map() };

describe('displayOrder', () => {
  it('prefers server names over maps', () => {
    const out = displayOrder(
      { ...base, equipment_name: 'Со слов мастера', area_name: 'Зона', assignee_name: 'Петров' },
      names,
    );
    expect(out.equipment_name).toBe('Со слов мастера');
    expect(out.area_name).toBe('Зона');
    expect(out.assignee_name).toBe('Петров');
  });

  it('resolves ids through catalog maps', () => {
    const out = displayOrder(base, names);
    expect(out.equipment_name).toBe('Насос Н-1');
    expect(out.area_name).toBe('Участок 1');
    expect(out.assignee_name).toBe('Иванов И.');
  });

  it('falls back to raw ids and dash', () => {
    const out = displayOrder(base, empty);
    expect(out.equipment_name).toBe('e1');
    expect(out.area_name).toBe('a1');
    expect(out.assignee_name).toBe('w1');
    const noIds = displayOrder(
      { ...base, equipment_id: null, area_id: null, assignee_id: null },
      empty,
    );
    expect(noIds.equipment_name).toBe('—');
    expect(noIds.area_name).toBeUndefined();
    expect(noIds.assignee_name).toBeUndefined();
  });

  it('picks kk names when lang is kk', () => {
    const nested = {
      ...base,
      equipment: { name: 'Насос', name_kk: 'Сорғы' },
      area: { name: 'Участок', name_kk: 'Учаске' },
    } as unknown as WorkOrder;
    const out = displayOrder(nested, empty, 'kk');
    expect(out.equipment_name).toBe('Сорғы');
    expect(out.area_name).toBe('Учаске');
  });

  it('keeps server codes untouched', () => {
    const out = displayOrder(base, names);
    expect(out.equipment_id).toBe('e1');
    expect(out.status).toBe('in_progress');
    expect(out.allowed_actions).toEqual([]);
  });
});
