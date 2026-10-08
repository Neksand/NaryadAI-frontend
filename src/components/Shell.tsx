import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { useAuthStore, roleHome } from '../store/auth-store';
import { logout } from '../api/auth';
import { getRefreshToken } from '../lib/api-client';
import { useRealtime } from '../hooks/useWS';

export function Shell({ tabs, children, title }: { tabs: { to: string; label: string; badge?: number }[]; children: ReactNode; title: string }) {
  const { t, i18n } = useTranslation();
  const loc = useLocation();
  const nav = useNavigate();
  const { user } = useAuthStore();
  const { status, reconnected } = useRealtime(true);

  const onLogout = async () => {
    try { await logout(getRefreshToken()); } finally { useAuthStore.getState().logout(); nav('/login'); }
  };

  const initial = (user?.full_name ?? '?').trim().charAt(0).toUpperCase();

  return (
    <div className="min-h-dvh flex flex-col mx-auto w-full max-w-3xl md:max-w-6xl">
      <header className="flex items-center gap-3 px-4 pt-4 pb-3 min-h-[64px]">
        <span className="avatar" aria-hidden="true">{initial}</span>
        <div className="flex-1 min-w-0">
          <b className="block text-[22px] leading-7 truncate">{title}</b>
          <span className="flex items-center gap-2 mt-0.5 text-[13px] text-[var(--ink-muted)]">
            <span className="truncate">{user?.full_name}</span>
            <span className="chip brand !py-0.5 !px-2 !text-[11px]">{t(`role.${user?.role ?? 'worker'}`)}</span>
            <span className={`conn ${status === 'open' ? 'on' : ''}`} title={status}>●</span>
          </span>
        </div>
        <button className="btn btn-sm" onClick={onLogout} aria-label={t('common.logout')} title={t('common.logout')}>⎋</button>
        <select
          aria-label="language / тіл"
          className="input !w-auto !min-h-[40px]"
          value={(i18n.language || 'ru').slice(0, 2)}
          onChange={(e) => { void i18n.changeLanguage(e.target.value); localStorage.setItem('naryadai.lang', e.target.value); }}
        >
          <option value="ru">RU</option>
          <option value="kk">KZ</option>
        </select>
      </header>

      {reconnected && status === 'open' && (
        <div className="mx-4 mb-2 banner banner-ai" role="status">{t('common.reconnected')}</div>
      )}

      <main className="flex-1 px-4 pb-6 flex flex-col gap-4">{children}</main>

      <nav className="tabbar sticky bottom-0" aria-label={t('common.mainNav')}>
        {tabs.map((tab) => (
          <Link key={tab.to} to={tab.to} className={`tab ${loc.pathname === tab.to ? 'on' : ''}`} aria-current={loc.pathname === tab.to ? 'page' : undefined}>
            <span>{tab.label}</span>
            {tab.badge ? <span className="badge">{tab.badge}</span> : null}
          </Link>
        ))}
        <Link to={roleHome(user?.role ?? null)} className="tab" aria-label={t('common.home')}>⌂<span>{t('common.home')}</span></Link>
      </nav>
    </div>
  );
}
