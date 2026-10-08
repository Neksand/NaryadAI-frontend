import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { catalogList, createEmployee, deleteDict, dictCreate, dictList, patchDict, resetPin, unblockUser, type CreateEmployeeInput } from '../api/misc';
import { Shell } from '../components/Shell';
import { ErrorState, SkeletonList } from '../components/ui';
import { toLocalizedError } from '../lib/api-client';

const TYPES = ['areas', 'equipment', 'crews', 'employees', 'fault-codes', 'materials', 'norms', 'reasons'];

interface EmployeeRow { id: string; login?: string; full_name?: string; name?: string; role?: string; crew_id?: string | null; shift?: string; area_ids?: string[] }

interface EditForm { id: string; login: string; full_name: string; role: string; shift: string; crew_id: string; area_ids: string[] }

export default function AdminPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [type, setType] = useState('areas');
  const list = useQuery({ queryKey: ['dict', type], queryFn: () => dictList(type) });
  const sites = useQuery({ queryKey: ['catalog', 'sites'], queryFn: () => catalogList('sites') });
  const faultCodes = useQuery({ queryKey: ['dict', 'fault-codes'], queryFn: () => dictList('fault-codes'), enabled: type === 'norms' });
  const crews = useQuery({ queryKey: ['catalog', 'teams'], queryFn: () => catalogList('teams'), enabled: type === 'employees' });
  const [msg, setMsg] = useState('');
  const [emp, setEmp] = useState<CreateEmployeeInput>({ login: '', pin: '', full_name: '', role: 'worker', area_ids: [] });
  const [newPin, setNewPin] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<EditForm | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // После создания инвалидируем и справочники для селектов (участки в форме бригады,
  // бригады в модалке редактирования), иначе только что созданное не появится без перезагрузки.
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['dict', type] });
    void qc.invalidateQueries({ queryKey: ['catalog'] });
  };

  const create = async () => {
    try {
      if (!/^\d{4,8}$/.test(emp.pin)) { setMsg(t('admin.pinHint')); return; }
      if (!emp.login.trim() || !emp.full_name.trim()) { setMsg(t('admin.loginRequired')); return; }
      await createEmployee({ ...emp, login: emp.login.trim() });
      setEmp({ login: '', pin: '', full_name: '', role: 'worker', area_ids: [] });
      setMsg('✓'); refresh();
    } catch (e) { setMsg(toLocalizedError(e).message); }
  };

  const pinMut = useMutation({
    mutationFn: ({ id, pin }: { id: string; pin: string }) => resetPin(id, pin),
    onSuccess: (_, v) => { setMsg(t('admin.pinResetOk')); setNewPin((s) => ({ ...s, [v.id]: '' })); },
    onError: (e) => setMsg(toLocalizedError(e).message),
  });
  const unblockMut = useMutation({
    mutationFn: (id: string) => unblockUser(id),
    onSuccess: () => setMsg(t('admin.unblockedOk')),
    onError: (e) => setMsg(toLocalizedError(e).message),
  });
  const saveMut = useMutation({
    mutationFn: (f: EditForm) => patchDict('employees', f.id, {
      login: f.login.trim(), full_name: f.full_name.trim(), role: f.role, shift: f.shift, crew_id: f.crew_id || null,
      area_ids: f.area_ids,
    }),
    onSuccess: () => { setMsg(t('admin.savedOk')); setEditing(null); refresh(); },
    onError: (e) => setMsg(toLocalizedError(e).message),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => deleteDict('employees', id),
    onSuccess: () => { setMsg(t('admin.deletedOk')); setConfirmDelete(null); refresh(); },
    onError: (e) => { setMsg(toLocalizedError(e).message); setConfirmDelete(null); },
  });

  const toggleArea = (id: string) =>
    setEmp((f) => ({ ...f, area_ids: (f.area_ids ?? []).includes(id) ? (f.area_ids ?? []).filter((a) => a !== id) : [...(f.area_ids ?? []), id] }));

  const openEdit = (it: EmployeeRow) => setEditing({
    id: it.id, login: it.login ?? '', full_name: it.full_name ?? it.name ?? '',
    role: it.role ?? 'worker', shift: it.shift ?? '1', crew_id: it.crew_id ?? '',
    area_ids: it.area_ids ?? [],
  });

  const toggleEditArea = (areaId: string) =>
    setEditing((f) => f ? { ...f, area_ids: f.area_ids.includes(areaId) ? f.area_ids.filter((a) => a !== areaId) : [...f.area_ids, areaId] } : f);  return (
    <Shell title={t('nav.admin')} tabs={[{ to: '/admin', label: t('nav.admin') }]}>
      <div className="flex gap-2 flex-wrap" role="tablist" aria-label={t('nav.admin')}>
        {TYPES.map((x) => (
          <button key={x} className={`btn btn-sm ${x === type ? 'btn-primary' : ''}`} onClick={() => setType(x)}>{t(`dictType.${x}`)}</button>
        ))}
      </div>

      {list.isPending ? <SkeletonList /> : list.isError ? <ErrorState message={toLocalizedError(list.error).message} onRetry={() => list.refetch()} /> : (
        <div className="card overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>{t('admin.tableId')}</th><th>{type === 'employees' ? t('admin.tableEmployee') : t('admin.tableName')}</th>{type === 'employees' && <><th>{t('auth.pin')}</th><th></th></>}</tr></thead>
            <tbody>
              {(list.data as EmployeeRow[]).slice(0, 50).map((it) => (
                <tr key={it.id}>
                  <td className="mono">{it.id.slice(0, 8)}</td>
                  <td>{type === 'employees' ? `${it.login ?? ''} · ${it.full_name ?? it.name ?? ''} · ${t(`role.${it.role ?? 'worker'}`)}` : (it.full_name ?? it.name ?? it.id)}</td>
                  {type === 'employees' && (
                    <>
                      <td>
                        <div className="flex gap-1">
                          <input
                            className="input input-sm !w-[110px]" inputMode="numeric" placeholder={t('admin.newPin')}
                            value={newPin[it.id] ?? ''} onChange={(e) => setNewPin((s) => ({ ...s, [it.id]: e.target.value.replace(/\D/g, '').slice(0, 8) }))}
                            aria-label={`${t('admin.newPin')} — ${it.login ?? it.id}`} />
                          <button
                            className="btn btn-sm" disabled={!/^\d{4,8}$/.test(newPin[it.id] ?? '') || pinMut.isPending}
                            onClick={() => pinMut.mutate({ id: it.id, pin: newPin[it.id] ?? '' })}>{t('auth.pin')}</button>
                        </div>
                      </td>
                      <td>
                        <div className="flex gap-1">
                          <button className="btn btn-sm" disabled={unblockMut.isPending} onClick={() => unblockMut.mutate(it.id)}>{t('admin.unblock')}</button>
                          <button className="btn btn-sm" onClick={() => { openEdit(it); setConfirmDelete(null); }}>{t('admin.edit')}</button>
                          {confirmDelete === it.id ? (
                            <button className="btn btn-sm btn-danger" disabled={delMut.isPending} onClick={() => delMut.mutate(it.id)}>{t('admin.sureDelete')}</button>
                          ) : (
                            <button className="btn btn-sm btn-danger-o" onClick={() => setConfirmDelete(it.id)}>{t('admin.delete')}</button>
                          )}
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {type === 'employees' ? (
        <div className="card flex flex-col gap-2" aria-label={t('admin.newEmployee')}>
          <b>{t('admin.newEmployee')}</b>
          <div className="grid grid-cols-2 gap-2">
            <input className="input" value={emp.login} onChange={(e) => setEmp({ ...emp, login: e.target.value })} placeholder={t('admin.loginPh')} aria-label={t('auth.login')} />
            <input className="input mono" value={emp.pin} onChange={(e) => setEmp({ ...emp, pin: e.target.value.replace(/\D/g, '').slice(0, 8) })} inputMode="numeric" placeholder={t('admin.pinHint')} aria-label={t('auth.pin')} />
          </div>
          <input className="input" value={emp.full_name} onChange={(e) => setEmp({ ...emp, full_name: e.target.value })} placeholder={t('admin.fio')} aria-label={t('admin.fio')} />
          <div className="flex gap-2 items-center">
            <label className="label !mb-0">{t('admin.roleLabel')}</label>
            <select className="input !w-auto" value={emp.role} onChange={(e) => setEmp({ ...emp, role: e.target.value as CreateEmployeeInput['role'] })} aria-label={t('admin.roleLabel')}>
              {(['worker', 'master', 'manager', 'admin'] as const).map((r) => (
                <option key={r} value={r}>{t(`role.${r}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <span className="label">{t('admin.areasLabel')}</span>
            <div className="flex gap-2 flex-wrap">
              {((sites.data ?? []) as { id: string; name: string }[]).map((a) => (
                <label key={a.id} className="chip neutral" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={(emp.area_ids ?? []).includes(a.id)} onChange={() => toggleArea(a.id)} aria-label={a.name} />
                  {a.name}
                </label>
              ))}
            </div>
          </div>
          <button className="btn btn-primary" disabled={!emp.login.trim() || !emp.full_name.trim() || !/^\d{4,8}$/.test(emp.pin)} onClick={create}>{t('admin.create')} +</button>
          {msg && <span className="chip neutral">{msg}</span>}
        </div>
      ) : (
        <GenericCreate
          key={type}
          type={type}
          sites={((sites.data ?? []) as { id: string; name: string }[])}
          faultCodes={((faultCodes.data ?? []) as { id: string; code: string; name: string }[])}
          onDone={(m) => { setMsg(m); refresh(); }}
        />
      )}

      {editing && (
        <div className="modal-scrim" onClick={() => setEditing(null)} role="presentation">
          <div className="modal-card" role="dialog" aria-label={t('admin.editEmployee')} onClick={(e) => e.stopPropagation()}>
            <b className="text-[17px]">{t('admin.editEmployee')}</b>
            <label className="flex flex-col gap-1"><span className="label">{t('auth.login')}</span>
              <input className="input" value={editing.login} onChange={(e) => setEditing({ ...editing, login: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1"><span className="label">{t('admin.fio')}</span>
              <input className="input" value={editing.full_name} onChange={(e) => setEditing({ ...editing, full_name: e.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1"><span className="label">{t('admin.roleLabel')}</span>
                <select className="input" value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value })}>
                  {(['worker', 'master', 'manager', 'admin'] as const).map((r) => (
                    <option key={r} value={r}>{t(`role.${r}`)}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1"><span className="label">{t('admin.shift')}</span>
                <select className="input" value={editing.shift} onChange={(e) => setEditing({ ...editing, shift: e.target.value })}>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="night">{t('admin.night')}</option>
                </select>
              </label>
            </div>
            <label className="flex flex-col gap-1"><span className="label">{t('admin.crew')}</span>
              <select className="input" value={editing.crew_id} onChange={(e) => setEditing({ ...editing, crew_id: e.target.value })}>
                <option value="">—</option>
                {((crews.data ?? []) as { id: string; name: string }[]).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <p className="text-sm text-[var(--ink-muted)]">{t('admin.areasNote')}</p>
            <div>
              <span className="label">{t('admin.areasLabel')}</span>
              <div className="flex gap-2 flex-wrap">
                {((sites.data ?? []) as { id: string; name: string }[]).map((a) => (
                  <label key={a.id} className="chip neutral" style={{ cursor: 'pointer' }}>
                    <input type="checkbox" checked={editing.area_ids.includes(a.id)} onChange={() => toggleEditArea(a.id)} aria-label={a.name} />
                    {a.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn" onClick={() => setEditing(null)}>{t('common.cancel')}</button>
              <button
                className="btn btn-primary grow" disabled={!editing.login.trim() || !editing.full_name.trim() || saveMut.isPending}
                onClick={() => saveMut.mutate(editing)}
              >
                {saveMut.isPending ? t('common.loading') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}

interface FieldDef {
  key: string;
  kind: 'text' | 'number' | 'select' | 'area' | 'fault';
  label: string;
  req?: boolean;
  options?: string[];
  def?: string;
  positive?: boolean;
}

const NUM_KEYS = new Set(['default_norm_minutes', 'typical_usage_per_order', 'minutes']);

/** Создание справочников: поля ровно под NOT NULL-ограничения бэкенда (иначе был 500 → «нет связи»). */
function GenericCreate({ type, sites, faultCodes, onDone }: {
  type: string;
  sites: { id: string; name: string }[];
  faultCodes: { id: string; code: string; name: string }[];
  onDone: (msg: string) => void;
}) {
  const { t } = useTranslation();

  const fields: FieldDef[] = (() => {
    switch (type) {
      case 'areas':
        return [
          { key: 'name', kind: 'text', label: t('common.name'), req: true },
          { key: 'code', kind: 'text', label: t('admin.fCode'), req: true },
        ];
      case 'equipment':
        return [
          { key: 'name', kind: 'text', label: t('common.name'), req: true },
          { key: 'inventory_no', kind: 'text', label: t('admin.fInvNo'), req: true },
          { key: 'area_id', kind: 'area', label: t('admin.fArea'), req: true },
          { key: 'type', kind: 'text', label: t('admin.fEqType'), req: true },
          { key: 'criticality', kind: 'select', label: t('admin.fCrit'), req: true, options: ['A', 'B', 'C'], def: 'B' },
        ];
      case 'crews':
        return [
          { key: 'name', kind: 'text', label: t('common.name'), req: true },
          { key: 'area_id', kind: 'area', label: t('admin.fArea'), req: true },
        ];
      case 'fault-codes':
        return [
          { key: 'code', kind: 'text', label: t('admin.fCode'), req: true },
          { key: 'fault_group', kind: 'select', label: t('admin.fGroup'), req: true, options: ['М', 'Э', 'Г', 'П', 'С'] },
          { key: 'name', kind: 'text', label: t('common.name'), req: true },
          { key: 'default_norm_minutes', kind: 'number', label: t('admin.fNorm'), positive: true },
        ];
      case 'materials':
        return [
          { key: 'name', kind: 'text', label: t('common.name'), req: true },
          { key: 'unit', kind: 'select', label: t('admin.fUnit'), req: true, options: ['шт', 'кг', 'л', 'м'] },
          { key: 'typical_usage_per_order', kind: 'number', label: t('admin.fTypical'), positive: true },
        ];
      case 'norms':
        return [
          { key: 'fault_code_id', kind: 'fault', label: t('admin.fFault'), req: true },
          { key: 'equipment_type', kind: 'text', label: t('admin.fEqType'), req: true },
          { key: 'minutes', kind: 'number', label: t('admin.fMinutes'), req: true, positive: true },
        ];
      case 'reasons':
        return [
          { key: 'kind', kind: 'select', label: t('admin.fKind'), req: true, options: ['reject', 'pause', 'cancel', 'downtime'], def: 'reject' },
          { key: 'code', kind: 'text', label: t('admin.fCode'), req: true },
          { key: 'name', kind: 'text', label: t('common.name'), req: true },
        ];
      default:
        return [{ key: 'name', kind: 'text', label: t('common.name'), req: true }];
    }
  })();

  const defaults = Object.fromEntries(fields.filter((f) => f.def).map((f) => [f.key, f.def as string]));
  const [gen, setGen] = useState<Record<string, string>>(defaults);
  const [busy, setBusy] = useState(false);

  const valid = fields.every((f) => {
    const v = (gen[f.key] ?? '').trim();
    if (f.req && !v) return false;
    if (v && f.positive && !(Number(v) > 0)) return false;
    return true;
  });

  const submit = async () => {
    const body: Record<string, unknown> = {};
    for (const f of fields) {
      const v = (gen[f.key] ?? '').trim();
      if (!v) continue;
      body[f.key] = NUM_KEYS.has(f.key) ? Number(v) : v;
    }
    setBusy(true);
    try {
      await dictCreate(type, body);
      setGen(defaults);
      onDone('✓');
    } catch (e) {
      onDone(toLocalizedError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const set = (k: string, v: string) => setGen((g) => ({ ...g, [k]: v }));

  return (
    <div className="card flex flex-col gap-2" aria-label={t('admin.create')}>
      <b>{t('dictType.' + type)} — {t('admin.create')}</b>
      {fields.map((f) => (
        <label key={f.key} className="flex flex-col gap-1">
          <span className="label">{f.label}{f.req ? ' *' : ''}</span>
          {f.kind === 'select' && (
            <select className="input" value={gen[f.key] ?? f.def ?? ''} onChange={(e) => set(f.key, e.target.value)}>
              {(f.options ?? []).map((o) => (
                <option key={o} value={o}>{f.key === 'kind' ? t(`admin.rk.${o}`) : o}</option>
              ))}
            </select>
          )}
          {f.kind === 'area' && (
            <select className="input" value={gen[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}>
              <option value="">—</option>
              {sites.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          {f.kind === 'fault' && (
            <select className="input" value={gen[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}>
              <option value="">—</option>
              {faultCodes.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
            </select>
          )}
          {(f.kind === 'text' || f.kind === 'number') && (
            <input
              className="input" value={gen[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}
              inputMode={f.kind === 'number' ? 'decimal' : undefined}
            />
          )}
        </label>
      ))}
      <button className="btn btn-primary" disabled={!valid || busy} onClick={submit}>
        {busy ? t('common.loading') : `${t('admin.create')} +`}
      </button>
    </div>
  );
}
