import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';

/** Своё поле срока вместо нативного datetime-local: нативный календарь в WebView
 *  показывает месяцы на языке системы (часто английский) и не слушается интерфейс.
 *  Формат строго дд.мм.гггг, чч:мм — одинаков для ru и kk. */
export function parseDueInput(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2})[.](\d{1,2})[.](\d{4})[ ,]+(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  const hh = Number(m[4]);
  const min = Number(m[5]);
  if (mm < 1 || mm > 12 || hh > 23 || min > 59) return null;
  const d = new Date(yyyy, mm - 1, dd, hh, min);
  if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null;
  return d.toISOString();
}

export function DateTimeField({
  value,
  onChange,
  required,
}: {
  value: string;
  onChange: (iso: string) => void;
  required?: boolean;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const today = new Date();
  const [viewY, setViewY] = useState(today.getFullYear());
  const [viewM, setViewM] = useState(today.getMonth());
  const [selD, setSelD] = useState<number | null>(null);
  const [selH, setSelH] = useState('09');
  const [selMin, setSelMin] = useState('00');

  const months = t('common.months', { returnObjects: true }) as unknown as string[];
  const weekdays = t('common.weekdays', { returnObjects: true }) as unknown as string[];

  const commit = (v: string) => {
    setText(v);
    if (!v.trim()) {
      setBad(false);
      onChange('');
      return;
    }
    const iso = parseDueInput(v);
    setBad(!iso);
    onChange(iso ?? '');
  };

  const preset = (hours: number) => {
    const iso = new Date(Date.now() + hours * 3600000).toISOString();
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    const s = `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
    commit(s);
  };

  const openCal = () => {
    const iso = parseDueInput(text);
    const base = iso ? new Date(iso) : new Date();
    setViewY(base.getFullYear());
    setViewM(base.getMonth());
    setSelD(iso ? base.getDate() : null);
    const p = (n: number) => String(n).padStart(2, '0');
    setSelH(p(base.getHours()));
    setSelMin(p(base.getMinutes()));
    setCalOpen(true);
  };

  const shiftMonth = (delta: number) => {
    const d = new Date(viewY, viewM + delta, 1);
    setViewY(d.getFullYear());
    setViewM(d.getMonth());
    setSelD(null);
  };

  const applyCal = () => {
    if (selD === null) {
      setCalOpen(false);
      return;
    }
    const p2 = (s: string) => s.padStart(2, '0');
    commit(`${p2(String(selD))}.${p2(String(viewM + 1))}.${viewY}, ${p2(selH)}:${p2(selMin)}`);
    setCalOpen(false);
  };

  // Сетка месяца, недели с понедельника.
  const firstGap = (new Date(viewY, viewM, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstGap).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const isToday = (d: number) => {
    const n = new Date();
    return d === n.getDate() && viewM === n.getMonth() && viewY === n.getFullYear();
  };

  return (
    <span className="flex flex-col gap-1">
      <span className="flex gap-1">
        <input
          className="input mono grow"
          value={text}
          onChange={(e) => commit(e.target.value)}
          placeholder={t('common.datePh')}
          required={required}
          inputMode="numeric"
          aria-label={t('master.due')}
        />
        <button
          type="button"
          className="btn"
          onClick={() => (calOpen ? setCalOpen(false) : openCal())}
          aria-expanded={calOpen}
          aria-label={t('common.pickDate')}
          title={t('common.pickDate')}
        >
          <Icon name="calendar" size={20} />
        </button>
      </span>
      <span className="flex gap-1 flex-wrap">
        {[1, 2, 4, 8].map((h) => (
          <button key={h} type="button" className="btn btn-sm" onClick={() => preset(h)}>
            {t('common.inHours', { n: h })}
          </button>
        ))}
      </span>
      {bad && value === '' && <span className="chip danger">{t('common.dateBad')}</span>}
      {calOpen && (
        <div className="card flex flex-col gap-2" role="dialog" aria-label={t('common.pickDate')}>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => shiftMonth(-1)}
              aria-label={t('common.back')}
            >
              <Icon name="chevL" size={16} />
            </button>
            <b>
              {months[viewM]} {viewY}
            </b>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => shiftMonth(1)}
              aria-label={t('common.next')}
            >
              <Icon name="chevR" size={16} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {weekdays.map((w) => (
              <span key={w} className="text-[11px] font-bold text-[var(--ink-muted)]">
                {w}
              </span>
            ))}
            {cells.map((d, i) =>
              d === null ? (
                <span key={`e${i}`} />
              ) : (
                <button
                  key={d}
                  type="button"
                  onClick={() => setSelD(d)}
                  aria-pressed={selD === d}
                  className={`btn btn-sm ${selD === d ? 'btn-primary' : ''} ${isToday(d) ? '!border-[var(--brand)]' : ''}`}
                >
                  {d}
                </button>
              ),
            )}
          </div>
          <div className="flex gap-2 items-center">
            <label className="flex gap-1 items-center">
              <input
                className="input mono !w-[64px]"
                value={selH}
                inputMode="numeric"
                onChange={(e) => setSelH(e.target.value.replace(/\D/g, '').slice(0, 2))}
                aria-label={t('master.due')}
              />
              :
              <input
                className="input mono !w-[64px]"
                value={selMin}
                inputMode="numeric"
                onChange={(e) => setSelMin(e.target.value.replace(/\D/g, '').slice(0, 2))}
                aria-label={t('master.due')}
              />
            </label>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                const n = new Date();
                setViewY(n.getFullYear());
                setViewM(n.getMonth());
                setSelD(n.getDate());
              }}
            >
              {t('common.today')}
            </button>
            <span className="flex gap-2 ml-auto">
              <button type="button" className="btn btn-sm" onClick={() => setCalOpen(false)}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={selD === null}
                onClick={applyCal}
              >
                {t('common.save')}
              </button>
            </span>
          </div>
        </div>
      )}
    </span>
  );
}
