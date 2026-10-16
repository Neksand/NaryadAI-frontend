import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { listNotifications, markAllRead, markRead } from '../api/misc';
import { Shell } from '../components/Shell';
import { EmptyState, ErrorState, SkeletonList } from '../components/ui';
import { toLocalizedError } from '../lib/api-client';
import { formatDT } from '../lib/dates';
import { Icon } from '../components/Icon';
import { useAuthStore } from '../store/auth-store';
import type { AppNotification } from '../types/domain';

// Относительное время показываем для свежих уведомлений (< 7 суток),
// старше — только абсолютную дату (функция возвращает '').
const RELATIVE_MAX_MS = 7 * 24 * 60 * 60 * 1000;

/** «5 мин назад» / «5 мин бұрын». Чистая функция: now подставляется в тестах. */
export function formatNotifRelative(
  value: string | number | Date | null | undefined,
  opts?: { now?: number | Date; lang?: string },
): string {
  if (value === null || value === undefined || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const now = opts?.now instanceof Date ? opts.now.getTime() : (opts?.now ?? Date.now());
  const diff = now - d.getTime();
  // Небольшое будущее (расхождение часов) — как «только что».
  if (diff < 0 && diff > -60_000) return opts?.lang === 'kk' ? 'қазір' : 'только что';
  if (diff < 0 || diff >= RELATIVE_MAX_MS) return '';
  const lang = (opts?.lang ?? 'ru').slice(0, 2);
  const kk = lang === 'kk';
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return kk ? 'қазір' : 'только что';
  if (diff < hour) {
    const n = Math.floor(diff / minute);
    return kk ? `${n} мин бұрын` : `${n} мин назад`;
  }
  if (diff < day) {
    const n = Math.floor(diff / hour);
    return kk ? `${n} сағ бұрын` : `${n} ч назад`;
  }
  const n = Math.floor(diff / day);
  return kk ? `${n} күн бұрын` : `${n} дн назад`;
}

const ORDER_ID_KEYS = [
  'work_order_id',
  'order_id',
  'related_entity_id',
  'entity_id',
  'id',
] as const;

function pickId(record: Record<string, unknown>): string | null {
  for (const key of ORDER_ID_KEYS) {
    const v = record[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

/** ID связанного наряда из data или полей верхнего уровня (passthrough схемы). */
export function notificationOrderId(n: AppNotification): string | null {
  const d = (n as { data?: unknown }).data;
  if (d && typeof d === 'object' && !Array.isArray(d)) {
    // В payload id — это id сущности (заказа/события), а не уведомления.
    const fromData = pickId(d as Record<string, unknown>);
    if (fromData) return fromData;
  }
  // На верхнем уровне id — это id самого уведомления, его пропускаем.
  const t = n as unknown as Record<string, unknown>;
  for (const key of ORDER_ID_KEYS.slice(0, 4)) {
    const v = t[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

// Ссылку строим только для типов, заведомо привязанных к наряду:
// WORKER_STATUS_CHANGED несёт id сотрудника — его за наряд не считаем.
const ORDER_LINKABLE = /^(WORK_ORDER|DEADLINE|AI_INSPECTION|AI_REVIEW|NOT_ACCEPTED|LONG_OVERDUE)/;

/** Маршрут карточки наряда по роли. Manager — null (нет детальной страницы наряда). */
export function notificationOrderLink(
  n: AppNotification,
  role: string | null | undefined,
): string | null {
  if (!ORDER_LINKABLE.test(n.type)) return null;
  const orderId = notificationOrderId(n);
  if (!orderId) return null;
  if (role === 'worker') return `/worker/orders/${orderId}`;
  if (role === 'master' || role === 'admin') return `/master/orders/${orderId}`;
  return null;
}

export default function NotificationsPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.role);
  const lang = (i18n.language || 'ru').slice(0, 2);

  // Обновления идут по WebSocket — поллинг не нужен.
  const q = useQuery({
    queryKey: ['notifications', 'all'],
    queryFn: () => listNotifications(false),
  });
  const read = useMutation({
    mutationFn: (id: string) => markRead(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
  const readAll = useMutation({
    mutationFn: () => markAllRead(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  return (
    <Shell title={t('nav.notifications')}>
      <button
        className="btn btn-sm min-h-11 self-end"
        onClick={() => readAll.mutate()}
        disabled={readAll.isPending}
      >
        <Icon name="checkAll" size={16} /> {t('notif.readAll')}
      </button>
      {q.isPending ? (
        <SkeletonList />
      ) : q.isError ? (
        <ErrorState message={toLocalizedError(q.error).message} onRetry={() => q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState text={t('notif.empty')} />
      ) : (
        <div className="flex flex-col gap-2">
          {q.data.map((n) => {
            const label = t(`notif.${n.type}`, n.type);
            const title = n.title ?? label;
            const abs = n.created_at ? formatDT(n.created_at) : '';
            const rel = formatNotifRelative(n.created_at, { lang });
            const link = notificationOrderLink(n, role);
            const mark = () => {
              if (!n.is_read) read.mutate(n.id);
            };
            const body = (
              <>
                <div className="flex gap-2 items-center justify-between flex-wrap">
                  <span className="chip ai">{label}</span>
                  {n.created_at ? (
                    <time
                      dateTime={n.created_at}
                      title={abs}
                      className="mono text-sm text-[var(--ink-muted)]"
                    >
                      {rel || abs}
                    </time>
                  ) : null}
                </div>
                <div className="font-semibold mt-1">{title}</div>
                {rel ? <div className="mono text-xs text-[var(--ink-muted)]">{abs}</div> : null}
                {n.body && <div className="text-sm text-[var(--ink-muted)]">{n.body}</div>}
              </>
            );
            // Вся строка — переход к наряду, если есть связанная сущность.
            // Без неё — кнопка «отметить прочитанным», уже прочитанные — статичный блок.
            if (link) {
              return (
                <Link
                  key={n.id}
                  to={link}
                  aria-label={`${title}. ${t('notif.openOrder')}`}
                  className="card !p-3 text-left min-h-[44px] block"
                  style={{ opacity: n.is_read ? 0.65 : 1 }}
                  onClick={mark}
                >
                  {body}
                </Link>
              );
            }
            if (!n.is_read) {
              return (
                <button
                  key={n.id}
                  type="button"
                  className="card !p-3 text-left min-h-[44px] w-full"
                  onClick={mark}
                >
                  {body}
                </button>
              );
            }
            return (
              <div
                key={n.id}
                className="card !p-3 text-left min-h-[44px]"
                style={{ opacity: 0.65 }}
              >
                {body}
              </div>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
