import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import axios from 'axios';
import { login } from '../api/auth';
import { useAuthStore, roleHome } from '../store/auth-store';
import { toLocalizedError } from '../lib/api-client';
import type { Role } from '../types/domain';
import { Icon, type IconName } from '../components/Icon';
import { SHOW_DEMO_LOGIN } from '../lib/env';

export function friendlyLoginError(raw: unknown, t: (key: string) => string): string {
  const err = toLocalizedError(raw);
  if (axios.isAxiosError(raw) && !raw.response) {
    const tech = raw.code ? ` [${raw.code}]` : '';
    if (raw.code === 'ECONNABORTED' || /timeout/i.test(raw.message ?? '')) {
      return t('auth.errTimeout') + tech;
    }
    return t('auth.errOffline') + tech;
  }
  if (err.status === 401) return t('auth.errBadCreds');
  if (err.status === 423) return t('auth.errLocked');
  if (err.status === 0) return t('auth.errOffline');
  return err.message || t('auth.errFallback');
}

const DEMO_META: { role: Role; icon: IconName }[] = [
  { role: 'worker', icon: 'orders' },
  { role: 'master', icon: 'shift' },
  { role: 'manager', icon: 'analytics' },
  { role: 'admin', icon: 'admin' },
];

const LOCAL_API_DEMO_CREDENTIALS: Record<Role, { loginName: string; pin: string }> = {
  worker: { loginName: 'worker01', pin: '1001' },
  master: { loginName: 'master1', pin: '3333' },
  manager: { loginName: 'manager1', pin: '2222' },
  admin: { loginName: 'admin', pin: '1234' },
};

export default function LoginPage() {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const [loginName, setLoginName] = useState('');
  const [pin, setPin] = useState('');

  const m = useMutation({
    mutationFn: (credentials: { loginName: string; pin: string }) =>
      login(credentials.loginName, credentials.pin),
    onSuccess: ({ user, access, refresh }) => {
      useAuthStore.getState().setSession(user, access, refresh);
      nav(roleHome(user.role), { replace: true });
    },
  });

  const errText = m.error ? friendlyLoginError(m.error, t) : null;

  const demoLogin = (role: Role) => {
    m.mutate(LOCAL_API_DEMO_CREDENTIALS[role]);
  };

  return (
    <div className="min-h-dvh flex flex-col justify-center px-6 max-w-md mx-auto gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="login-brand">
          <img
            src="/icon.svg"
            alt="НарядAI"
            width={52}
            height={52}
            className="login-logo-img"
            style={{ borderRadius: 14 }}
          />
          <div>
            <h1 className="text-[32px] leading-[38px] font-bold">НарядAI</h1>
            <p className="text-[var(--ink-muted)]">{t('auth.title')}</p>
          </div>
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
      </div>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (loginName && pin) m.mutate({ loginName: loginName.trim(), pin: pin.trim() });
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="label">{t('auth.login')}</span>
          <input
            className="input"
            value={loginName}
            onChange={(e) => setLoginName(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">{t('auth.pin')}</span>
          <input
            className="input mono"
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
            inputMode="numeric"
            autoComplete="current-password"
            required
            minLength={4}
            maxLength={8}
          />
        </label>
        {errText && (
          <div className="banner banner-danger" role="alert">
            {errText}
          </div>
        )}
        <button
          className="btn btn-primary btn-lg btn-block"
          type="submit"
          disabled={m.isPending || !loginName || pin.length < 4}
        >
          {m.isPending ? t('common.loading') : t('auth.submit')}
        </button>
      </form>
      {SHOW_DEMO_LOGIN && (
        <div className="card flex flex-col gap-2">
          <div className="text-sm font-semibold">{t('auth.demoTitle')}</div>
          <div className="text-sm text-[var(--ink-muted)]">{t('auth.demoHint')}</div>
          <div className="grid grid-cols-2 gap-2">
            {DEMO_META.map(({ role, icon }) => (
              <button
                key={role}
                className="btn btn-sm"
                type="button"
                disabled={m.isPending}
                onClick={() => demoLogin(role)}
              >
                <Icon name={icon} size={18} /> {t(`role.${role}`)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
