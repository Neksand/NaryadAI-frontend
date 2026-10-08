import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { login } from '../api/auth';
import { useAuthStore, roleHome } from '../store/auth-store';
import { toLocalizedError } from '../lib/api-client';

export default function LoginPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [loginName, setLoginName] = useState('');
  const [pin, setPin] = useState('');

  const m = useMutation({
    mutationFn: () => login(loginName.trim(), pin.trim()),
    onSuccess: ({ user, access, refresh }) => {
      useAuthStore.getState().setSession(user, access, refresh);
      nav(roleHome(user.role), { replace: true });
    },
  });

  const err = m.error ? toLocalizedError(m.error) : null;

  return (
    <div className="min-h-dvh flex flex-col justify-center px-6 max-w-md mx-auto gap-4">
      <h1 className="text-[32px] leading-[38px] font-bold">НарядAI</h1>
      <p className="text-[var(--ink-muted)]">{t('auth.title')}</p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => { e.preventDefault(); if (loginName && pin) m.mutate(); }}
      >
        <label className="flex flex-col gap-1">
          <span className="label">{t('auth.login')}</span>
          <input className="input" value={loginName} onChange={(e) => setLoginName(e.target.value)} autoComplete="username" required />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">{t('auth.pin')}</span>
          <input
            className="input mono" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
            inputMode="numeric" autoComplete="current-password" required minLength={4} maxLength={8}
          />
        </label>
        {err && (
          <div className="banner banner-danger" role="alert">
            {err.status === 423 ? t('auth.locked') : err.message || t('auth.error')}
          </div>
        )}
        <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={m.isPending || !loginName || pin.length < 4}>
          {m.isPending ? t('common.loading') : t('auth.submit')}
        </button>
      </form>
    </div>
  );
}
