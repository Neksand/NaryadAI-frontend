import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { catalogList } from '../api/misc';
import { api } from '../lib/api-client';
import { pickName, pickPersonName } from '../lib/names';
import type { WorkOrder } from '../types/domain';

export interface NameMaps {
  areas: Map<string, string>;
  equipment: Map<string, string>;
  users: Map<string, string>;
}

interface IdName {
  id: string;
  name?: string;
  name_kk?: string;
  full_name?: string;
  login?: string;
  code?: string;
}

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
  const { i18n } = useTranslation();
  const lang = (i18n.language || 'ru').slice(0, 2);
  const sites = useQuery({
    queryKey: ['catalog', 'sites'],
    queryFn: () => catalogList('sites'),
    staleTime: 60000,
  });
  const equip = useQuery({
    queryKey: ['catalog', 'equipment', 'all'],
    queryFn: () => catalogList('equipment'),
    staleTime: 60000,
  });
  const workers = useQuery({
    queryKey: ['workers', 'all'],
    queryFn: async () => {
      try {
        const { data } = await api.get('/workers');
        return (Array.isArray(data) ? data : (data.items ?? data.data ?? [])) as IdName[];
      } catch {
        return [] as IdName[];
      }
    },
    staleTime: 60000,
  });

  return useMemo(
    () => ({
      areas: toMap(sites.data, (a) => pickName(a, lang) || a.name),
      equipment: toMap(equip.data, (e) => pickName(e, lang) || e.name),
      users: toMap(workers.data, (u) => pickPersonName(u, lang) ?? u.login),
    }),
    [sites.data, equip.data, workers.data, lang],
  );
}

/** Подменяет ID названиями на языке интерфейса там, где бэкенд их не прислал. Коды на сервер не затрагивает. */
export function displayOrder<T extends WorkOrder>(order: T, names: NameMaps, lang = 'ru'): T {
  const nested = order as unknown as {
    equipment?: { name?: string; name_kk?: string };
    area?: { name?: string; name_kk?: string };
  };
  const loc = (ru?: string | null, kk?: string | null) =>
    lang === 'kk' && kk && kk.trim() ? kk : (ru ?? undefined);
  const equipId = order.equipment_id ?? undefined;
  const areaId = order.area_id ?? undefined;
  const assigneeId = order.assignee_id ?? undefined;
  return {
    ...order,
    equipment_name:
      loc(order.equipment_name, (order as { equipment_name_kk?: string }).equipment_name_kk) ??
      loc(nested.equipment?.name, nested.equipment?.name_kk) ??
      (equipId ? names.equipment.get(equipId) : undefined) ??
      equipId ??
      '—',
    area_name:
      loc(order.area_name, (order as { area_name_kk?: string }).area_name_kk) ??
      loc(nested.area?.name, nested.area?.name_kk) ??
      (areaId ? names.areas.get(areaId) : undefined) ??
      areaId ??
      undefined,
    assignee_name:
      order.assignee_name ??
      (assigneeId ? names.users.get(assigneeId) : undefined) ??
      assigneeId ??
      undefined,
  };
}
