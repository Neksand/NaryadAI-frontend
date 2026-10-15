import { useTranslation } from 'react-i18next';

export default function VersionConflictNotice({
  currentVersion,
  onRefresh,
}: {
  currentVersion: number;
  onRefresh: () => void | Promise<void>;
}) {
  const { t } = useTranslation();

  return (
    <div className="banner banner-warn flex items-center gap-2" role="alert">
      <span className="flex-1">{t('version.conflict', { currentVersion })}</span>
      <button className="btn btn-sm" type="button" onClick={() => void onRefresh()}>
        {t('version.conflictRefresh')}
      </button>
    </div>
  );
}
