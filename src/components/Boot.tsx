import { Component, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

// Ловит краш lazy-чанк / рендера и показывает экран с перезапуском
// вместо пустого #root (чёрный экран в APK).
export function BootScreen({ note }: { note?: string }) {
  const { t } = useTranslation();
  return (
    <div className="boot" role="status" aria-label="НарядAI">
      <div className="boot-card">
        <img src="/icon.svg" alt="НарядAI" width={64} height={64} />
        <div className="boot-title">НарядAI</div>
        <div className="boot-sub">{t('boot.sub')}</div>
        <div className="boot-spinner" aria-hidden="true" />
        {note && <div className="boot-note">{note}</div>}
      </div>
    </div>
  );
}

function CrashFallback() {
  const { t } = useTranslation();
  return (
    <div className="p-4 max-w-md mx-auto flex flex-col gap-3" style={{ paddingTop: 48 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>{t('boot.crashTitle')}</h1>
      <p style={{ color: 'var(--ink-muted)' }}>{t('boot.crashText')}</p>
      <button
        className="btn btn-primary btn-lg btn-block"
        onClick={() => {
          try {
            localStorage.removeItem('naryadai.refresh');
          } catch {
            /* ignore */
          }
          window.location.hash = '#/login';
          window.location.reload();
        }}
      >
        {t('boot.restart')}
      </button>
    </div>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.error('[react-crash]', error);
  }
  render() {
    if (this.state.error) {
      return <CrashFallback />;
    }
    return this.props.children;
  }
}
