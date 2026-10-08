import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { catalogList } from '../api/misc';
import { api } from '../lib/api-client';
import type { WorkOrder } from '../types/domain';

export interface NameMaps {
  areas: Map<string, string>;
  equipment: Map<string, string>;
  users: Map<string, string>;
}

interface IdName { id: string; name?: string; full_name?: string; login?: string; code?: string }

function toMap(items: unknown, label: (it: IdName) => string | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const it of (items ?? []) as IdName[]) {
    if (it?.id) {
      const v = label(it);
      if (v) m.set(it.id, v);
    }
  }
  return m;
}

/**
 * Справочники имён для списков: GET /work-orders отдаёт только ID
 * (без JOIN имён), поэтому названия подставляем из каталогов.
 * Запросы кэшируются — десятки карточек делят один fetch.
 */
export function useNames(): NameMaps {
  const sites = useQuery({ queryKey: ['catalog', 'sites'], queryFn: () => catalogList('sites'), staleTime: 60000 });
  const equip = useQuery({ queryKey: ['catalog', 'equipment', 'all'], queryFn: () => catalogList('equipment'), staleTime: 60000 });
  const workers = useQuery({
    queryKey: ['workers', 'all'],
    queryFn: async () => {
      try {
        const { data } = await api.get('/workers');
        return (Array.isArray(data) ? data : (data.items ?? data.data ?? [])) as IdName[];
      } catch { return [] as IdName[]; }
    },
    staleTime: 60000,
  });

  return useMemo(() => ({
    areas: toMap(sites.data, (a) => a.name),
    equipment: toMap(equip.data, (e) => e.name),
    users: toMap(workers.data, (u) => u.full_name ?? u.login),
  }), [sites.data, equip.data, workers.data]);
}

/** Подменяет ID русскими названиями там, где бэкенд их не прислал. Коды на сервер не затрагивает. */
export function displayOrder<T extends WorkOrder>(order: T, names: NameMaps): T {
  const nested = order as unknown as {
    equipment?: { name?: string }; area?: { name?: string };
  };
  const equipId = order.equipment_id ?? undefined;
  const areaId = order.area_id ?? undefined;
  const assigneeId = order.assignee_id ?? undefined;
  return {
    ...order,
    equipment_name: order.equipment_name ?? nested.equipment?.name ?? (equipId ? names.equipment.get(equipId) : undefined) ?? equipId ?? '—',
    area_name: order.area_name ?? nested.area?.name ?? (areaId ? names.areas.get(areaId) : undefined) ?? areaId ?? undefined,
    assignee_name: order.assignee_name ?? (assigneeId ? names.users.get(assigneeId) : undefined) ?? assigneeId ?? undefined,
  };
}
