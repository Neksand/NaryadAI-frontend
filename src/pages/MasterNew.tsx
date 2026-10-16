import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createWorkOrder, getSimilarRepairs } from '../api/workOrders';
import { suggestAssignee } from '../api/ai';
import { catalogList } from '../api/misc';
import {
  uploadPhoto,
  deletePhoto,
  describePhotoFailure,
  ensureFileReadable,
  photoSourceLabel,
} from '../api/photos';
import { Shell, roleTabs } from '../components/Shell';
import { VoiceButton } from '../components/VoiceButton';
import { DateTimeField } from '../components/DateTimeField';
import { AITag, ErrorState } from '../components/ui';
import { Lightbox, type LightboxItem } from '../components/Lightbox';
import { api, toLocalizedError, newUUID } from '../lib/api-client';
import { pickName } from '../lib/names';
import { Icon } from '../components/Icon';
import { useOfflineQueue } from '../hooks/useOfflineQueue';
import {
  saveOfflinePhoto,
  getOfflinePhoto,
  readStagedFile,
  addOfflinePhotoDraftRef,
  listOfflinePhotoDraftRefs,
  removeOfflinePhotoDraftRefs,
  removeOfflinePhotos,
  type OfflinePhotoSource,
  type PendingPhotoRef,
} from '../lib/offline-photos';
import { useAuthStore } from '../store/auth-store';

const BEFORE_LIMIT = 5;
const MASTER_NEW_DRAFT_KEY = 'master-new';

function isHeicFile(f: File): boolean {
  const name = (f.name || '').toLowerCase();
  const type = (f.type || '').toLowerCase();
  return (
    name.endsWith('.heic') ||
    name.endsWith('.heif') ||
    type === 'image/heic' ||
    type === 'image/heif' ||
    type === 'image/heic-sequence' ||
    type === 'image/heif-sequence'
  );
}

export default function MasterNew() {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language || 'ru').slice(0, 2);
  const nav = useNavigate();
  const [form, setForm] = useState({
    kind: 'unplanned',
    description: '',
    area_id: '',
    equipment_id: '',
    assignee_id: '',
    crew_id: '',
    priority: 'high',
    due_at: '',
    norm_minutes: 60,
    equipment_stopped: false,
    comment: '',
  });
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  // Durable retries use the IndexedDB id. A picker File is retained only if
  // IndexedDB itself could not stage the initial selection.
  const [pendingFailedPhoto, setPendingFailedPhoto] = useState<
    | { localId: string; source: OfflinePhotoSource }
    | { file: File; source: OfflinePhotoSource }
    | null
  >(null);
  const photoBusyRef = useRef(false);
  const draftKeyRef = useRef<string | null>(null);
  const previewUrlsRef = useRef<Record<string, string>>({});
  const [photosHydrated, setPhotosHydrated] = useState(false);
  // Offline draft photos: blobs in per-employee IndexedDB, uploaded before create.
  const [pendingLocalPhotos, setPendingLocalPhotos] = useState<PendingPhotoRef[]>([]);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);
  const [brokenPreviews, setBrokenPreviews] = useState<Record<string, true>>({});
  const markBroken = (key: string) =>
    setBrokenPreviews((p) => (p[key] ? p : { ...p, [key]: true as const }));
  const [lightboxKey, setLightboxKey] = useState<string | null>(null);
  const [draftQueued, setDraftQueued] = useState(false);
  const offline = useOfflineQueue();
  const draftUserId = useAuthStore((s) => s.user?.id ?? 'anonymous');
  const queuedPhotoIds = offline.queue
    .flatMap((op) => (op.pendingPhotos ?? []).map((photo) => photo.localId))
    .sort()
    .join('|');

  const areas = useQuery({ queryKey: ['catalog', 'sites'], queryFn: () => catalogList('sites') });
  const equipment = useQuery({
    queryKey: ['catalog', 'equipment', form.area_id],
    queryFn: () => catalogList('equipment', form.area_id ? { area_id: form.area_id } : {}),
  });
  const workers = useQuery({
    queryKey: ['workers'],
    queryFn: async () => {
      try {
        const { api } = await import('../lib/api-client');
        const { data } = await api.get('/workers');
        return Array.isArray(data) ? data : (data.items ?? data.data ?? []);
      } catch {
        return [];
      }
    },
  });
  const crews = useQuery({
    queryKey: ['catalog', 'teams', form.area_id || 'all'],
    queryFn: () => catalogList('teams', form.area_id ? { area_id: form.area_id } : {}),
  });
  // Исполнители участка: члены его бригад (со статусами). Без участка — все.
  const areaWorkers = useQuery({
    queryKey: ['workers', 'by-area', form.area_id || 'all'],
    queryFn: async () => {
      if (!form.area_id) return null;
      const teamsRaw = await catalogList('teams', { area_id: form.area_id });
      const teams = (Array.isArray(teamsRaw) ? teamsRaw : []) as {
        id: string;
      }[];
      const out: {
        id: string;
        full_name?: string;
        name?: string;
        current_status?: string;
        crew_id?: string;
      }[] = [];
      for (const team of teams) {
        if (!team?.id) continue;
        let teamData: unknown = null;
        try {
          const { data } = await api.get(`/teams/${team.id}`);
          teamData = (data as { data?: unknown }).data ?? data;
        } catch {
          continue;
        }
        const members = Array.isArray((teamData as { members?: unknown })?.members)
          ? ((teamData as { members: typeof out }).members ?? [])
          : [];
        for (const m of members) out.push({ ...m, crew_id: team.id });
      }
      return out;
    },
    enabled: Boolean(form.area_id),
    staleTime: 30000,
  });
  const areaWorkerIds = new Set((areaWorkers.data ?? []).map((w) => w.id));
  const areaCrewIds = new Set(((crews.data ?? []) as { id: string }[]).map((c) => c.id));
  const assigneeMismatch =
    Boolean(form.area_id) &&
    Boolean(form.assignee_id) &&
    areaWorkers.data != null &&
    !areaWorkerIds.has(form.assignee_id);
  const crewMismatch =
    Boolean(form.area_id) &&
    Boolean(form.crew_id) &&
    (crews.data ?? []).length >= 0 &&
    !areaCrewIds.has(form.crew_id) &&
    !crews.isPending;
  const similar = useQuery({
    queryKey: ['similar-repairs', form.equipment_id],
    queryFn: () => getSimilarRepairs(form.equipment_id, { limit: 3 }),
    enabled: Boolean(form.equipment_id),
  });

  const ai = useMutation({
    mutationFn: () =>
      suggestAssignee({
        area_id: form.area_id,
        equipment_id: form.equipment_id || undefined,
        priority: form.priority,
        description: form.description,
      }),
  });

  const create = useMutation({
    networkMode: 'always',
    mutationFn: async () => {
      // Ключ стабилен на черновик: повтор после обрыва — replay того же
      // наряда, а не дубликат с конфликтом photo_ids.
      if (!draftKeyRef.current) draftKeyRef.current = newUUID();
      const key = draftKeyRef.current;
      const payload = {
        // area_id бэкенд не принимает (участок выводится из оборудования) — только обязательные поля CreateWO.
        // due_at уже ISO из DateTimeField (дд.мм.гггг, чч:мм), повторно не парсим.
        kind: form.kind,
        description: form.description.trim(),
        equipment_id: form.equipment_id,
        assignee_id: form.assignee_id || undefined,
        crew_id: form.crew_id || undefined,
        priority: form.priority,
        due_at: form.due_at,
        norm_minutes: form.norm_minutes,
        equipment_stopped: form.equipment_stopped,
        photo_ids: photoIds,
        comment: form.comment.trim() || undefined,
      };
      const isOffline =
        !offline.online || (typeof navigator !== 'undefined' && navigator.onLine === false);
      // Offline draft with photos: persist blobs per-employee, enqueue one
      // idempotent create; replay uploads photos first (upload-then-act).
      if (pendingLocalPhotos.length > 0) {
        await offline.enqueue({
          key,
          orderId: 'new',
          action: 'create',
          opType: 'create',
          body: payload,
          pendingPhotos: pendingLocalPhotos.map((p) => ({ localId: p.localId, kind: p.kind })),
          clientAt: new Date().toISOString(),
        });
        await removeOfflinePhotoDraftRefs(
          draftUserId,
          MASTER_NEW_DRAFT_KEY,
          pendingLocalPhotos.map((photo) => photo.localId),
        );
        setPendingLocalPhotos([]);
        setPreviewUrls((current) => {
          const next = { ...current };
          for (const photo of pendingLocalPhotos) {
            const url = next[photo.localId];
            if (url) URL.revokeObjectURL?.(url);
            delete next[photo.localId];
          }
          return next;
        });
        if (!isOffline) void offline.replay();
        return { queued: true as const };
      }
      if (isOffline) {
        await offline.enqueue({
          key,
          orderId: 'new',
          action: 'create',
          opType: 'create',
          body: payload,
          clientAt: new Date().toISOString(),
        });
        return { queued: true as const };
      }
      return createWorkOrder(payload, key);
    },
    onSuccess: (order) => {
      draftKeyRef.current = null;
      if ((order as { queued?: boolean } | undefined)?.queued) {
        setDraftQueued(true);
        return;
      }
      nav(`/master/orders/${(order as { id: string }).id}`);
    },
  });

  /** Первое поле из details[] ответа валидации бэкенда — вместо голого «проверьте данные». */
  function firstValidationDetail(err: unknown): string | null {
    if (typeof err !== 'object' || err === null) return null;
    const data = (err as { response?: { data?: unknown } }).response?.data;
    if (typeof data !== 'object' || data === null) return null;
    const details = (data as { error?: { details?: unknown } }).error?.details;
    if (!Array.isArray(details) || !details.length) return null;
    const first = details[0] as { path?: unknown; message?: unknown };
    const where = typeof first.path === 'string' && first.path ? `${first.path}: ` : '';
    return typeof first.message === 'string' && first.message ? `${where}${first.message}` : null;
  }

  const totalPhotos = photoIds.length + pendingLocalPhotos.length;
  const isPhotoLimitReached = totalPhotos >= BEFORE_LIMIT;
  const photoLimitHint = t('master.photoLimit', 'Достигнут лимит: максимум 5 фото');

  const makePreviewUrl = (f: File | Blob): string | undefined => {
    try {
      if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        return URL.createObjectURL(f);
      }
    } catch {
      /* jsdom without object URLs — previews render as placeholders */
    }
    return undefined;
  };

  useEffect(() => {
    previewUrlsRef.current = previewUrls;
  }, [previewUrls]);

  useEffect(() => {
    let active = true;
    setPhotosHydrated(false);
    setPendingLocalPhotos([]);
    setPendingFailedPhoto(null);
    const load = async () => {
      const queuedIds = new Set(queuedPhotoIds.split('|').filter(Boolean));
      const refs = await listOfflinePhotoDraftRefs(draftUserId, MASTER_NEW_DRAFT_KEY);
      const available: PendingPhotoRef[] = [];
      const missing: string[] = [];
      const urls: Record<string, string> = {};
      for (const ref of refs) {
        if (queuedIds.has(ref.localId)) {
          missing.push(ref.localId);
          continue;
        }
        const record = await getOfflinePhoto(draftUserId, ref.localId);
        if (!record?.data) {
          missing.push(ref.localId);
          continue;
        }
        available.push({ ...ref, source: ref.source ?? record.source });
        const url = makePreviewUrl(record.data);
        if (url) urls[ref.localId] = url;
      }
      if (!active) {
        Object.values(urls).forEach((url) => URL.revokeObjectURL?.(url));
        return;
      }
      if (missing.length) {
        await removeOfflinePhotoDraftRefs(draftUserId, MASTER_NEW_DRAFT_KEY, missing);
      }
      setPendingLocalPhotos(available);
      setPreviewUrls((current) => {
        const stale = new Set([...refs.map((ref) => ref.localId), ...queuedIds]);
        for (const key of stale) {
          if (urls[key] || !current[key]) continue;
          URL.revokeObjectURL?.(current[key]);
        }
        const next = { ...current };
        stale.forEach((key) => {
          if (!urls[key]) delete next[key];
        });
        return { ...next, ...urls };
      });
      setPhotosHydrated(true);
    };
    void load();
    return () => {
      active = false;
    };
    // makePreviewUrl only uses URL and has no component state dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftUserId, queuedPhotoIds]);

  useEffect(
    () => () => {
      Object.values(previewUrlsRef.current).forEach((url) => {
        try {
          URL.revokeObjectURL?.(url);
        } catch {
          /* object URL cleanup is best effort */
        }
      });
    },
    [],
  );

  const handlePhotoFile = async (f: File, source: OfflinePhotoSource = 'picker') => {
    if (photoBusyRef.current || !photosHydrated) return;
    if (totalPhotos >= BEFORE_LIMIT) return;
    photoBusyRef.current = true;
    setUploadingPhoto(true);
    const startedAt = Date.now();
    if (isHeicFile(f)) {
      setPhotoError(
        t('master.heicHint', 'HEIC не поддерживается: снимите камерой или выберите JPEG/PNG'),
      );
      photoBusyRef.current = false;
      setUploadingPhoto(false);
      return;
    }
    // Staged-загрузка: байты СРАЗУ в IDB. Дальше оригинал f не трогаем —
    // всё (превью, сжатие, заливка) идёт из IDB-копии, ей гранты не страшны.
    let staged: File;
    let stagedLocalId: string | null = null;
    try {
      const rec = await saveOfflinePhoto(draftUserId, f, 'before', f.name, source);
      stagedLocalId = rec.localId;
      const back = await getOfflinePhoto(draftUserId, rec.localId);
      const bytes = back?.data ?? null;
      if (!bytes) throw new Error('PHOTO_FILE_UNREADABLE: файл недоступен на устройстве');
      staged = new File([bytes], rec.name || f.name, { type: bytes.type || f.type });
    } catch (err) {
      if (stagedLocalId) await removeOfflinePhotos(draftUserId, [stagedLocalId]).catch(() => {});
      setPhotoError(
        `${err instanceof Error ? err.message.replace(/^PHOTO_FILE_UNREADABLE:\s*/, '') : String(err)} · ${photoSourceLabel(source)}`,
      );
      setPendingFailedPhoto({ file: f, source });
      photoBusyRef.current = false;
      setUploadingPhoto(false);
      return;
    }
    const localId = stagedLocalId;
    try {
      await ensureFileReadable(staged);
    } catch (err) {
      await removeOfflinePhotos(draftUserId, [localId]).catch(() => {});
      setPhotoError(
        `${err instanceof Error ? err.message.replace(/^PHOTO_FILE_UNREADABLE:\s*/, '') : String(err)} · ${photoSourceLabel(source)}`,
      );
      setPendingFailedPhoto({ file: f, source });
      photoBusyRef.current = false;
      setUploadingPhoto(false);
      return;
    }
    try {
      await addOfflinePhotoDraftRef(draftUserId, MASTER_NEW_DRAFT_KEY, {
        localId,
        kind: 'before',
        source,
      });
    } catch (err) {
      await removeOfflinePhotos(draftUserId, [localId]).catch(() => {});
      setPhotoError(`${toLocalizedError(err).message} · ${photoSourceLabel(source)}`);
      setPendingFailedPhoto({ file: f, source });
      photoBusyRef.current = false;
      setUploadingPhoto(false);
      return;
    }
    const preview = makePreviewUrl(staged);
    if (preview) setPreviewUrls((p) => ({ ...p, [localId]: preview }));
    setPendingLocalPhotos((p) => [...p, { localId, kind: 'before', source }]);
    const offlineNow =
      !offline.online || (typeof navigator !== 'undefined' && navigator.onLine === false);
    if (offlineNow) {
      setPhotoError(null);
      setPendingFailedPhoto(null);
      photoBusyRef.current = false;
      setUploadingPhoto(false);
      return;
    }
    try {
      setUploadPct(null);
      setPhotoError(null);
      const r = await uploadPhoto(staged, 'before', undefined, (pct) => setUploadPct(pct));
      if (preview) {
        setPreviewUrls((p) => {
          const next = { ...p, [r.id]: preview };
          delete next[localId];
          return next;
        });
      }
      setPhotoIds((p) => [...p, r.id]);
      setPendingLocalPhotos((p) => p.filter((item) => item.localId !== localId));
      await removeOfflinePhotoDraftRefs(draftUserId, MASTER_NEW_DRAFT_KEY, [localId]);
      await removeOfflinePhotos(draftUserId, [localId]);
      setPendingFailedPhoto(null);
    } catch (err) {
      setPhotoError(
        `${toLocalizedError(err).message} (${describePhotoFailure(staged, startedAt, err, source)})`,
      );
      setPendingFailedPhoto({ localId, source });
    } finally {
      photoBusyRef.current = false;
      setUploadingPhoto(false);
      setUploadPct(null);
    }
  };

  const retryStagedPhoto = async (localId: string, selectedSource: OfflinePhotoSource) => {
    if (photoBusyRef.current) return;
    photoBusyRef.current = true;
    setUploadingPhoto(true);
    const startedAt = Date.now();
    let stagedFile: File | null = null;
    let source = selectedSource;
    try {
      const staged = await readStagedFile(draftUserId, localId);
      if (!staged) throw new Error('Фото больше не найдено в локальном хранилище');
      stagedFile = staged.file;
      source = staged.record.source ?? selectedSource;
      await ensureFileReadable(staged.file);
      const isOffline =
        !offline.online || (typeof navigator !== 'undefined' && navigator.onLine === false);
      if (isOffline) {
        throw new Error('Нет подключения к сети');
      }
      setPhotoError(null);
      const result = await uploadPhoto(staged.file, 'before', undefined, setUploadPct);
      const existingPreview = previewUrlsRef.current[localId];
      setPhotoIds((p) => (p.includes(result.id) ? p : [...p, result.id]));
      setPendingLocalPhotos((p) => p.filter((photo) => photo.localId !== localId));
      setPreviewUrls((p) => {
        const next = { ...p };
        delete next[localId];
        if (existingPreview) next[result.id] = existingPreview;
        return next;
      });
      await removeOfflinePhotoDraftRefs(draftUserId, MASTER_NEW_DRAFT_KEY, [localId]);
      await removeOfflinePhotos(draftUserId, [localId]);
      setPendingFailedPhoto(null);
    } catch (err) {
      if (!stagedFile) {
        await removeOfflinePhotoDraftRefs(draftUserId, MASTER_NEW_DRAFT_KEY, [localId]);
        await removeOfflinePhotos(draftUserId, [localId]);
        setPendingLocalPhotos((p) => p.filter((photo) => photo.localId !== localId));
        setPendingFailedPhoto(null);
        setPhotoError('Фото больше не найдено в хранилище. Выберите его повторно.');
      } else {
        setPhotoError(
          `${toLocalizedError(err).message} (${describePhotoFailure(stagedFile, startedAt, err, source)})`,
        );
        setPendingFailedPhoto({ localId, source });
      }
    } finally {
      photoBusyRef.current = false;
      setUploadingPhoto(false);
      setUploadPct(null);
    }
  };

  const handleRetryPhoto = () => {
    if (photoBusyRef.current || !pendingFailedPhoto) return;
    if ('localId' in pendingFailedPhoto) {
      void retryStagedPhoto(pendingFailedPhoto.localId, pendingFailedPhoto.source);
    } else {
      void handlePhotoFile(pendingFailedPhoto.file, pendingFailedPhoto.source);
    }
  };

  // Возврат из камеры/сна часто убивает висящую загрузку: при появлении сети
  // или foreground автоматически повторяем последний неуспешный файл.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const maybeResume = () => {
      if (document.visibilityState === 'hidden') return;
      handleRetryPhoto();
    };
    window.addEventListener('online', maybeResume);
    document.addEventListener('visibilitychange', maybeResume);
    return () => {
      window.removeEventListener('online', maybeResume);
      document.removeEventListener('visibilitychange', maybeResume);
    };
  });

  const handleDeleteUploaded = async (photoId: string) => {
    if (typeof window !== 'undefined' && !window.confirm(t('admin.sureDelete'))) return;
    try {
      setPhotoError(null);
      setDeletingPhotoId(photoId);
      await deletePhoto(photoId);
      setPhotoIds((p) => p.filter((id) => id !== photoId));
      setPreviewUrls((p) => {
        const next = { ...p };
        if (next[photoId]) URL.revokeObjectURL?.(next[photoId]);
        delete next[photoId];
        return next;
      });
    } catch (err) {
      setPhotoError(toLocalizedError(err).message);
    } finally {
      setDeletingPhotoId(null);
    }
  };

  const handleDeleteOffline = async (localId: string) => {
    if (typeof window !== 'undefined' && !window.confirm(t('admin.sureDelete'))) return;
    try {
      setPhotoError(null);
      setDeletingPhotoId(localId);
      await removeOfflinePhotoDraftRefs(draftUserId, MASTER_NEW_DRAFT_KEY, [localId]);
      await removeOfflinePhotos(draftUserId, [localId]);
      setPendingLocalPhotos((p) => p.filter((item) => item.localId !== localId));
      setPreviewUrls((p) => {
        const next = { ...p };
        if (next[localId]) URL.revokeObjectURL?.(next[localId]);
        delete next[localId];
        return next;
      });
    } catch (err) {
      setPhotoError(toLocalizedError(err).message);
    } finally {
      setDeletingPhotoId(null);
    }
  };

  const canSubmit =
    form.equipment_id &&
    form.due_at &&
    form.description.trim().length >= 1 &&
    (form.assignee_id || form.crew_id) &&
    !assigneeMismatch &&
    !crewMismatch &&
    photosHydrated &&
    !create.isPending &&
    !uploadingPhoto;

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const err = create.isError ? toLocalizedError(create.error) : null;
  const errDetail = create.isError ? firstValidationDetail(create.error) : null;

  return (
    <Shell title={t('master.newOrder')} tabs={roleTabs(t, 'master')}>
      <div className="card flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('master.kind')}>
          {(['planned', 'unplanned'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={form.kind === k}
              className={`btn ${form.kind === k ? 'btn-primary' : ''}`}
              onClick={() => set('kind', k)}
            >
              {t(`kind.${k}`, k === 'planned' ? 'Плановый' : 'Внеплановый')}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1">
          <span className="label">{t('master.area')} *</span>
          <select
            className="input"
            value={form.area_id}
            onChange={(e) => {
              set('area_id', e.target.value);
              // Списки исполнителей/бригад привязаны к участку — сбрасываем,
              // чтобы не выстрелил чужой выбор с прошлого участка.
              set('assignee_id', '');
              set('crew_id', '');
            }}
            required
          >
            <option value="">—</option>
            {((areas.data ?? []) as { id: string; name: string; name_kk?: string }[]).map((a) => (
              <option key={a.id} value={a.id}>
                {pickName(a, lang) || a.name}
              </option>
            ))}
          </select>
        </label>
        {!areas.isPending && (areas.data ?? []).length === 0 && (
          <div className="banner banner-warn" role="note">
            {t('master.noAreas')}
          </div>
        )}
        <label className="flex flex-col gap-1">
          <span className="label">{t('master.equipment')} *</span>
          <select
            className="input"
            value={form.equipment_id}
            onChange={(e) => set('equipment_id', e.target.value)}
            required
          >
            <option value="">—</option>
            {((equipment.data ?? []) as { id: string; name: string; name_kk?: string }[]).map(
              (e) => (
                <option key={e.id} value={e.id}>
                  {pickName(e, lang) || e.name}
                </option>
              ),
            )}
          </select>
        </label>
        <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="label">{t('master.priority')}</span>
            <select
              className="input"
              value={form.priority}
              onChange={(e) => set('priority', e.target.value)}
            >
              <option value="critical">{t('priority.critical')}</option>
              <option value="high">{t('priority.high')}</option>
              <option value="normal">{t('priority.normal')}</option>
              <option value="planned">{t('priority.planned')}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="label">{t('master.due')} *</span>
            <DateTimeField value={form.due_at} onChange={(iso) => set('due_at', iso)} required />
          </label>
        </div>
        <div className="flex flex-col gap-1">
          <div className="label">
            <label htmlFor="order-description">{t('master.description')} *</label>{' '}
            <VoiceButton
              onText={(txt) =>
                set('description', (form.description ? form.description + ' ' : '') + txt)
              }
            />
          </div>
          <textarea
            id="order-description"
            className="input area"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            required
            maxLength={4000}
          />
        </div>
        <label className="flex flex-col gap-1">
          <span className="label">{t('master.assigneeHint')}</span>
          <select
            className="input"
            value={form.assignee_id}
            onChange={(e) => {
              set('assignee_id', e.target.value);
              if (e.target.value) set('crew_id', '');
            }}
          >
            <option value="">—</option>
            {(
              (form.area_id ? (areaWorkers.data ?? []) : (workers.data ?? [])) as {
                id: string;
                full_name?: string;
                name?: string;
                current_status?: string;
              }[]
            ).map((w) => (
              <option key={w.id} value={w.id}>
                {w.full_name ?? w.name ?? w.id}
                {w.current_status
                  ? ` · ${t(`empStatus.${w.current_status}`, w.current_status)}`
                  : ''}
              </option>
            ))}
          </select>
        </label>
        {assigneeMismatch && (
          <div className="banner banner-warn" role="note">
            {t(
              'master.assigneeNotInArea',
              'Исполнитель не прикреплён к выбранному участку — выберите из списка',
            )}
          </div>
        )}
        {!workers.isPending && (workers.data ?? []).length === 0 && (
          <div className="banner banner-warn" role="note">
            {t('master.noWorkers')}
          </div>
        )}
        <label className="flex flex-col gap-1">
          <span className="label">
            {t('master.crew')} ({t('common.or')})
          </span>
          <select
            className="input"
            value={form.crew_id}
            onChange={(e) => {
              set('crew_id', e.target.value);
              if (e.target.value) set('assignee_id', '');
            }}
          >
            <option value="">—</option>
            {((crews.data ?? []) as { id: string; name?: string; name_kk?: string }[]).map((c) => (
              <option key={c.id} value={c.id}>
                {pickName(c, lang) || c.name || c.id}
              </option>
            ))}
          </select>
        </label>
        {crewMismatch && (
          <div className="banner banner-warn" role="note">
            {t(
              'master.crewNotInArea',
              'Бригада не относится к выбранному участку — выберите из списка',
            )}
          </div>
        )}
        <div className="flex gap-2">
          <button
            className="btn btn-ai"
            disabled={!form.area_id || !form.description || ai.isPending}
            onClick={() => ai.mutate()}
          >
            <Icon name="spark" size={18} /> {t('ai.recommendation')}
          </button>
        </div>
        {ai.data && (
          <div className="flex flex-col gap-2">
            {(Array.isArray(ai.data)
              ? ai.data
              : (ai.data.candidates ?? ai.data.suggestions ?? ai.data.data ?? [])
            )
              .slice(0, 3)
              .map(
                (
                  c: {
                    employee_id?: string;
                    id?: string;
                    full_name?: string;
                    score?: number;
                    confidence?: number;
                    reasons?: string[];
                    explanation?: string;
                  },
                  i: number,
                ) => (
                  <div key={i} className="card !p-3">
                    <AITag
                      confidence={c.score ?? c.confidence}
                      explanation={(c.reasons ?? []).join('; ') || c.explanation || c.full_name}
                    />
                    <button
                      className="btn btn-sm btn-ai mt-2"
                      onClick={() => {
                        set('assignee_id', c.employee_id ?? c.id ?? '');
                        set('crew_id', '');
                      }}
                    >
                      {t('ai.apply')}
                    </button>
                  </div>
                ),
              )}
          </div>
        )}
        {form.equipment_id && (
          <div className="flex flex-col gap-2">
            <span className="label">{t('master.similarRepairs')}</span>
            {similar.isPending && <span className="text-sm opacity-70">{t('common.loading')}</span>}
            {!similar.isPending && (similar.data ?? []).length === 0 && (
              <span className="text-sm opacity-70">{t('master.noSimilar')}</span>
            )}
            {(similar.data ?? []).slice(0, 3).map((r) => (
              <div key={r.id} className="card !p-3">
                <div className="flex items-center justify-between gap-2">
                  <AITag
                    confidence={r.match_score}
                    explanation={(r.match_reasons ?? []).join('; ') || r.fault_name || ''}
                  />
                  <span className="chip">
                    {t('master.historyOrder', { number: r.number ?? '—' })}
                  </span>
                </div>
                {r.fault_code && (
                  <div className="text-sm mt-1">
                    {r.fault_code}
                    {r.fault_name ? ` — ${r.fault_name}` : ''}
                  </div>
                )}
                {r.work_done_text && (
                  <div className="text-sm mt-1">
                    {t('master.repairOutcome')}: {r.work_done_text}
                  </div>
                )}
                {r.materials && r.materials.length > 0 && (
                  <div className="text-sm opacity-80 mt-1">
                    {t('master.materialsUsed')}:{' '}
                    {r.materials.map((m) => `${m.name} ${m.quantity} ${m.unit}`).join(', ')}
                  </div>
                )}
                {r.work_done_text && (
                  <button
                    className="btn btn-sm mt-2"
                    onClick={() =>
                      set(
                        'description',
                        (form.description ? form.description + ' ' : '') + r.work_done_text,
                      )
                    }
                  >
                    {t('master.applyWork')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <label className="flex flex-col gap-1">
          <span className="label">{t('common.comment')}</span>
          <input
            className="input"
            value={form.comment}
            maxLength={4000}
            onChange={(e) => set('comment', e.target.value)}
          />
        </label>
        <label className="flex gap-2 items-center min-h-[48px]">
          <input
            type="checkbox"
            checked={form.equipment_stopped}
            onChange={(e) => set('equipment_stopped', e.target.checked)}
          />
          {t('master.equipmentStopped')}
        </label>
        <div className="flex flex-col gap-1">
          <span className="label">{t('master.beforePhoto')}</span>
          <span role="status" aria-live="polite">
            {t('master.photoCount', `Фото ${totalPhotos} из ${BEFORE_LIMIT}`)}
          </span>
          <div className="flex gap-2">
            <label className="file-btn">
              <Icon name="camera" size={22} /> {t('master.photoPick', 'Выбрать фото')}
              <input
                type="file"
                className="hidden"
                accept="image/*"
                aria-label={t('master.photoPick', 'Выбрать фото')}
                disabled={uploadingPhoto || isPhotoLimitReached || !photosHydrated}
                title={isPhotoLimitReached ? photoLimitHint : undefined}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  void handlePhotoFile(f, 'picker');
                }}
              />
            </label>
            <label className="file-btn">
              <Icon name="camera" size={22} /> {t('master.photoCamera', 'Снять фото')}
              <input
                type="file"
                className="hidden"
                accept="image/*"
                capture="environment"
                aria-label={t('master.photoCamera', 'Снять фото')}
                disabled={uploadingPhoto || isPhotoLimitReached || !photosHydrated}
                title={isPhotoLimitReached ? photoLimitHint : undefined}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  void handlePhotoFile(f, 'camera');
                }}
              />
            </label>
          </div>
          <span className="text-xs opacity-70">
            {t(
              'master.photoPickerSourceNote',
              'Системный выбор: галерея/файлы/SD-карта; точный источник не определяется',
            )}
          </span>
          {isPhotoLimitReached && (
            <span role="note" className="text-sm opacity-70">
              {photoLimitHint}
            </span>
          )}
          {uploadingPhoto && (
            <span role="status">
              {t('common.loading')}
              {uploadPct != null ? ` ${uploadPct}%` : ''}
            </span>
          )}
          {totalPhotos > 0 && (
            <span className="chip ok">
              <Icon name="check" size={14} /> {totalPhotos}
            </span>
          )}
          {(photoIds.length > 0 || pendingLocalPhotos.length > 0) && (
            <div className="grid grid-cols-2 gap-2">
              {photoIds.map((photoId) => (
                <div
                  key={photoId}
                  className="relative card !p-2"
                  data-testid={`photo-preview-${photoId}`}
                >
                  {previewUrls[photoId] && !brokenPreviews[photoId] ? (
                    <button
                      type="button"
                      className="block w-full !p-0 !border-0 !bg-transparent"
                      onClick={() => setLightboxKey(photoId)}
                      aria-label={t('lightbox.open', 'Открыть фото')}
                    >
                      <img
                        src={previewUrls[photoId]}
                        alt={t('master.beforePhoto')}
                        className="w-full max-h-40 object-contain rounded"
                        onError={() => markBroken(photoId)}
                      />
                    </button>
                  ) : (
                    <div className="text-sm mono break-all">
                      {brokenPreviews[photoId]
                        ? t('master.photoNoPreview', 'Превью недоступно')
                        : photoId}
                    </div>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-danger-o absolute top-1 right-1"
                    aria-label={`Удалить фото ${photoId}`}
                    disabled={deletingPhotoId === photoId}
                    onClick={() => void handleDeleteUploaded(photoId)}
                  >
                    ×
                  </button>
                </div>
              ))}
              {pendingLocalPhotos.map((p) => (
                <div
                  key={p.localId}
                  className="relative card !p-2"
                  data-testid={`photo-preview-${p.localId}`}
                >
                  {previewUrls[p.localId] && !brokenPreviews[p.localId] ? (
                    <button
                      type="button"
                      className="block w-full !p-0 !border-0 !bg-transparent"
                      onClick={() => setLightboxKey(p.localId)}
                      aria-label={t('lightbox.open', 'Открыть фото')}
                    >
                      <img
                        src={previewUrls[p.localId]}
                        alt={t('master.beforePhoto')}
                        className="w-full max-h-40 object-contain rounded"
                        onError={() => markBroken(p.localId)}
                      />
                    </button>
                  ) : (
                    <div className="text-sm mono break-all">
                      {brokenPreviews[p.localId]
                        ? t('master.photoNoPreview', 'Превью недоступно')
                        : `${t('common.queued')}: ${p.localId.slice(0, 8)}`}
                    </div>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-danger-o absolute top-1 right-1"
                    aria-label={`Удалить фото ${p.localId}`}
                    disabled={deletingPhotoId === p.localId}
                    onClick={() => void handleDeleteOffline(p.localId)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {(() => {
            const keys = [
              ...photoIds.filter((id) => previewUrls[id] && !brokenPreviews[id]),
              ...pendingLocalPhotos
                .map((p) => p.localId)
                .filter((id) => previewUrls[id] && !brokenPreviews[id]),
            ];
            const items: LightboxItem[] = keys.map((key) => ({
              src: previewUrls[key],
              alt: t('master.beforePhoto'),
            }));
            const at = lightboxKey ? keys.indexOf(lightboxKey) : -1;
            return (
              at >= 0 && (
                <Lightbox
                  items={items}
                  index={at}
                  onClose={() => setLightboxKey(null)}
                  onIndex={(i) => setLightboxKey(keys[i] ?? null)}
                />
              )
            );
          })()}
          {pendingLocalPhotos.length > 0 && (
            <span role="status" className="text-sm opacity-70">
              {t('common.offline')} · {t('common.queued')}: {pendingLocalPhotos.length}
            </span>
          )}
          {photoError && (
            <div className="banner banner-danger" role="alert">
              {photoError}
              {pendingFailedPhoto && !uploadingPhoto && (
                <button type="button" className="btn btn-sm mt-2" onClick={handleRetryPhoto}>
                  {t('common.retry')}
                </button>
              )}
            </div>
          )}
        </div>
        {draftQueued && (
          <div className="banner banner-warn" role="status">
            {t('common.offline')} · {t('common.queued')}
          </div>
        )}
        {err && <ErrorState message={errDetail ? `${err.message}: ${errDetail}` : err.message} />}
        <button
          className="btn btn-primary btn-xl btn-block"
          disabled={!canSubmit}
          onClick={() => create.mutate()}
        >
          {create.isPending ? t('common.loading') : t('master.newOrder')}
        </button>
      </div>
    </Shell>
  );
}
