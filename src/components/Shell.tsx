import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { useAuthStore, roleHome } from '../store/auth-store';
import { logout } from '../api/auth';
import { getRefreshToken } from '../lib/api-client';
import { useRealtime } from '../hooks/useWS';
import { Icon, type IconName } from './Icon';

export interface TabDef {
  to: string;
  label: string;
  badge?: number;
  icon?: IconName;
}

const TAB_ICONS: Record<string, IconName> = {
  '/worker': 'orders',
  '/worker/history': 'history',
  '/master': 'shift',
  '/master/board': 'board',
  '/manager': 'analytics',
  '/admin': 'admin',
  '/notifications': 'bell',
};

/** Единые вкладки по роли — не исчезают при переходе (уведомления входят в набор). */
export function roleTabs(t: TFunction, role: string | null, unread?: number): TabDef[] {
  const badge = unread || undefined;
  const bell = (to: string, label: string): TabDef => ({ to, label, badge });
  if (role === 'worker') {
    return [
      { to: '/worker', label: t('nav.orders') },
      { to: '/worker/history', label: t('worker.done') },
      bell('/notifications', t('nav.notifications')),
    ];
  }
  if (role === 'manager') {
    return [
      { to: '/manager', label: t('nav.analytics') },
      bell('/notifications', t('nav.notifications')),
    ];
  }
  if (role === 'admin') {
    return [
      { to: '/admin', label: t('nav.admin') },
      bell('/notifications', t('nav.notifications')),
    ];
  }
  // master (и фолбэк): смена + доска + уведомления; создание — кнопкой, не вкладкой
  return [
    { to: '/master', label: t('master.shift') },
    { to: '/master/board', label: t('nav.board') },
    bell('/notifications', t('nav.notifications')),
  ];
}

export function Shell({
  tabs: propsTabs,
  children,
  title,
}: {
  tabs?: TabDef[];
  children: ReactNode;
  title: string;
}) {
  const { t, i18n } = useTranslation();
  const loc = useLocation();
  const nav = useNavigate();
  const { user } = useAuthStore();
  const { status, reconnected } = useRealtime(true);
  // Без явных вкладок — ролевые (не исчезают при переходах).
  const tabs = propsTabs ?? roleTabs(t, user?.role ?? null);
  const home = roleHome(user?.role ?? null);
  const isHome = loc.pathname === home;
  const goBack = () => {
    if (window.history.length > 1) nav(-1);
    else nav(home);
  };

  const onLogout = async () => {
    try {
      await logout(getRefreshToken());
    } finally {
      useAuthStore.getState().logout();
      nav('/login');
    }
  };

  const initial = (user?.full_name ?? '?').trim().charAt(0).toUpperCase();

  return (
    <div className="min-h-dvh flex flex-col mx-auto w-full max-w-3xl md:max-w-6xl">
      <header className="app-header flex flex-wrap sm:flex-nowrap items-center gap-2 px-4 pt-4 pb-3 min-h-[64px]">
        {!isHome && (
          <button
            className="btn btn-sm min-h-11 min-w-11"
            onClick={goBack}
            aria-label={t('common.back')}
          >
            <Icon name="back" size={18} />{' '}
            <span className="hidden sm:inline">{t('common.back')}</span>
          </button>
        )}
        <span className="avatar mr-auto sm:mr-0" aria-hidden="true">
          {initial}
        </span>
        <div className="order-last basis-full sm:order-none sm:basis-auto sm:flex-1 min-w-0">
          <b className="block text-[22px] leading-7 truncate">{title}</b>
          <span className="flex items-center gap-2 mt-0.5 text-[13px] text-[var(--ink-muted)]">
            {user?.role === 'worker' ? (
              <Link
                className="truncate underline-offset-2 hover:underline"
                to="/worker/profile"
                aria-label={t('nav.profile')}
              >
                {user.full_name}
              </Link>
            ) : (
              <span className="truncate">{user?.full_name}</span>
            )}
            <span className="chip brand !py-0.5 !px-2 !text-[11px]">
              {t(`role.${user?.role ?? 'worker'}`)}
            </span>
            <span className={`conn ${status === 'open' ? 'on' : ''}`} title={status}>
              ●
            </span>
          </span>
        </div>
        <select
          aria-label="language / тіл"
          className="lang-select"
          value={(i18n.language || 'ru').slice(0, 2)}
          onChange={(e) => {
            void i18n.changeLanguage(e.target.value);
            localStorage.setItem('naryadai.lang', e.target.value);
          }}
        >
          <option value="ru">RU</option>
          <option value="kk">KZ</option>
        </select>
        <button
          className="btn btn-sm min-h-11 min-w-11"
          onClick={onLogout}
          aria-label={t('common.logout')}
        >
          <Icon name="logout" size={18} />{' '}
          <span className="hidden sm:inline">{t('common.logout')}</span>
        </button>
      </header>

      {reconnected && status === 'open' && (
        <div className="mx-4 mb-2 banner banner-ai" role="status">
          {t('common.reconnected')}
        </div>
      )}

      <main className="flex-1 px-4 pb-6 flex flex-col gap-4">{children}</main>

      <nav className="tabbar sticky bottom-0" aria-label={t('common.mainNav')}>
        <div className="tabbar-row">
          <div className="tabbar-scroll">
            {tabs.map((tab) => (
              <Link
                key={tab.to}
                to={tab.to}
                className={`tab ${loc.pathname === tab.to ? 'on' : ''}`}
                aria-current={loc.pathname === tab.to ? 'page' : undefined}
              >
                <Icon name={tab.icon ?? TAB_ICONS[tab.to] ?? 'orders'} size={22} />
                <span>{tab.label}</span>
                {tab.badge ? <span className="badge">{tab.badge}</span> : null}
              </Link>
            ))}
          </div>
        </div>
      </nav>
    </div>
  );
}
