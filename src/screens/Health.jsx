import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Button, Modal, Field, Input, Textarea, SegmentedControl, SkeletonCard } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { listHealthLogs, saveHealthLog, deleteHealthLog, listDiary, saveDiary } from '../lib/db.js';
import { KINDS, kindInfo, validateLog, formatLog, latestByKind, waterForDay, dailySeries, averageOf, sleepWords, kgToLb } from '../lib/healthLogs.js';
import { MOODS, todaysMood } from '../lib/homeWidgets.js';
import { localDateStr, prettyClock, prettyDate } from '../lib/format.js';

const dayOf = (iso) => localDateStr(undefined, new Date(iso));
// "Today, 9:10 AM" / "Yesterday, 9:10 AM" / "Sat, Nov 7, 9:10 AM"
function whenWords(iso) {
  const d = new Date(iso);
  const day = dayOf(iso);
  const y = new Date(); y.setDate(y.getDate() - 1);
  const label = day === localDateStr() ? 'Today' : day === localDateStr(undefined, y) ? 'Yesterday'
    : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  return `${label}, ${prettyClock(d)}`;
}
// A <input type="datetime-local"> value in the device's own time.
function localInputValue(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Health tracker: what the person chose to write down, shown back exactly.
// It never fills in a missing reading, sets a target or says whether a number
// is good or bad — that is a conversation for their doctor or pharmacist.
export default function Health() {
  const ui = useUI();
  const navigate = useNavigate();
  const { profile } = useApp();
  const [tab, setTab] = useState('today');
  const [logging, setLogging] = useState(null); // { kind, row? }
  const [choosing, setChoosing] = useState(false);
  const [moodOpen, setMoodOpen] = useState(false);
  const weightUnit = profile?.weight_unit === 'lb' ? 'lb' : 'kg';
  const { data, loading, error, reload } = useAsync(async () => {
    const from = new Date(); from.setDate(from.getDate() - 92);
    const [logs, diary] = await Promise.all([listHealthLogs({ fromIso: from.toISOString() }), listDiary(40).catch(() => [])]);
    return { logs, diary };
  }, []);

  async function remove(row) {
    const k = kindInfo(row.kind);
    const ok = await ui.confirm({
      title: 'Delete this entry?',
      message: `${k.label}: ${formatLog(row, { weightUnit })}, ${whenWords(row.logged_at)}. This cannot be undone.`,
      confirmLabel: 'Delete', danger: true,
    });
    if (!ok) return;
    try { await deleteHealthLog(row.id); ui.toast('Deleted.', 'info'); reload(); }
    catch (e) { ui.toast(e.message || 'Could not delete. The entry is unchanged.', 'bad'); }
  }

  if (loading) return <div className="stack"><SkeletonCard lines={2} /><SkeletonCard lines={3} /></div>;
  if (error) return <Card className="center"><p className="lead">We could not load your health tracker.</p><Button onClick={reload}>Try again</Button></Card>;

  const { logs, diary } = data;
  const today = localDateStr();
  const latest = latestByKind(logs);
  const water = waterForDay(logs, today, dayOf);
  const mood = todaysMood(diary, today, dayOf);

  return (
    <div className="stack health">
      <SegmentedControl label="Diary section" value="health" onChange={(v) => { if (v === 'notes') navigate('/updates'); }} options={[
        { value: 'notes', label: 'Notes' },
        { value: 'health', label: 'Health tracker' },
      ]} />

      <SegmentedControl kind="tabs" idBase="health" label="Health tracker view" value={tab} onChange={setTab} options={[
        { value: 'today', label: 'Latest', icon: 'heartPulse' },
        { value: 'history', label: 'Trends & history', icon: 'chart' },
      ]} />

      {tab === 'today' ? (
        <div role="tabpanel" id="health-panel-today" aria-labelledby="health-tab-today" className="stack">
          <ul className="hgrid" aria-label="Measurements">
            <HealthCard kind="water" value={water ? water.text : null} when={water ? 'Today' : null} empty="Not logged today" onLog={() => setLogging({ kind: 'water' })} />
            <HealthCard kind="sleep" row={latest.sleep} weightUnit={weightUnit} onLog={() => setLogging({ kind: 'sleep' })} />
            <li className="hcard2">
              <span className="hcard2__ic" aria-hidden="true"><Icon name="smile" size={26} /></span>
              <div className="hcard2__main">
                <h3 className="hcard2__t">Mood</h3>
                <p className="hcard2__v">{mood ? mood.mood.label : <span className="hcard2__none">Not logged today</span>}</p>
                {mood && <p className="hcard2__when">{whenWords(mood.entry.entry_at)}</p>}
              </div>
              <button type="button" className="hcard2__log" aria-label={mood ? 'Change today’s mood' : 'Log mood'} onClick={() => setMoodOpen(true)}>
                <Icon name="plus" size={20} stroke={2.6} /> {mood ? 'Change' : 'Log'}
              </button>
            </li>
            <HealthCard kind="blood_pressure" row={latest.blood_pressure} weightUnit={weightUnit} onLog={() => setLogging({ kind: 'blood_pressure' })} />
            <HealthCard kind="weight" row={latest.weight} weightUnit={weightUnit} onLog={() => setLogging({ kind: 'weight' })} />
            <HealthCard kind="heart_rate" row={latest.heart_rate} weightUnit={weightUnit} onLog={() => setLogging({ kind: 'heart_rate' })} />
          </ul>

          <button type="button" className="rd-row rd-row--card" onClick={() => navigate('/updates', { state: { add: 'diary', draft: { category: 'symptom' } } })}>
            <span className="rd-row__ic" aria-hidden="true"><Icon name="pulse" size={24} /></span>
            <span className="rd-row__main">
              <span className="rd-row__t">Symptoms</span>
              <span className="rd-row__d">Add how you feel to your diary notes</span>
            </span>
            <Icon name="chevron" size={22} className="rd-row__chev" />
          </button>

          <Button icon="plus" size="lg" onClick={() => setChoosing(true)}>Log a measurement</Button>
          <p className="health-note"><Icon name="info" size={20} />
            <span>MyDay shows what you enter. It does not set targets or judge a reading. Ask your doctor or pharmacist what your numbers mean for you.</span></p>
        </div>
      ) : (
        <div role="tabpanel" id="health-panel-history" aria-labelledby="health-tab-history" className="stack">
          <Trends logs={logs} weightUnit={weightUnit} onEdit={(row) => setLogging({ kind: row.kind, row })} onDelete={remove} onLog={(kind) => setLogging({ kind })} />
        </div>
      )}

      {choosing && (
        <Modal title="What would you like to log?" onClose={() => setChoosing(false)}>
          <ul className="rd-list">
            {KINDS.map((k) => (
              <li key={k.id}>
                <button type="button" className="rd-row" onClick={() => { setChoosing(false); setLogging({ kind: k.id }); }}>
                  <span className="rd-row__ic" aria-hidden="true"><Icon name={k.icon} size={24} /></span>
                  <span className="rd-row__main"><span className="rd-row__t">{k.label}</span></span>
                  <Icon name="chevron" size={22} className="rd-row__chev" />
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}
      {logging && <LogForm kind={logging.kind} row={logging.row} weightUnit={weightUnit}
        onClose={() => setLogging(null)} onSaved={() => { setLogging(null); reload(); }} />}
      {moodOpen && <MoodPicker current={mood} onClose={() => setMoodOpen(false)} onSaved={() => { setMoodOpen(false); reload(); }} />}
    </div>
  );
}

// One measurement: its newest value with units and when it was logged, or a
// plain "Not logged" — never a blank that could be read as zero.
function HealthCard({ kind, row, value, when, empty = 'Not logged', weightUnit, onLog }) {
  const k = kindInfo(kind);
  const shown = value ?? (row ? formatLog(row, { weightUnit }) : null);
  const at = when ?? (row ? whenWords(row.logged_at) : null);
  return (
    <li className="hcard2">
      <span className="hcard2__ic" aria-hidden="true"><Icon name={k.icon} size={26} /></span>
      <div className="hcard2__main">
        <h3 className="hcard2__t">{k.label}</h3>
        <p className="hcard2__v">{shown || <span className="hcard2__none">{empty}</span>}</p>
        {shown && at && <p className="hcard2__when">{at}</p>}
      </div>
      <button type="button" className="hcard2__log" aria-label={k.logLabel} onClick={onLog}>
        <Icon name="plus" size={20} stroke={2.6} /> Log
      </button>
    </li>
  );
}

// The form for one reading. Each kind has its own fields and units; errors
// sit under the field they are about and are read out when they appear.
function LogForm({ kind, row, weightUnit, onClose, onSaved }) {
  const ui = useUI();
  const k = kindInfo(kind);
  const editing = !!row;
  const [f, setF] = useState(() => initialFields(kind, row, weightUnit));
  const [when, setWhen] = useState(() => localInputValue(row ? new Date(row.logged_at) : new Date()));
  const [note, setNote] = useState(row?.note || '');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (patch) => setF((v) => ({ ...v, ...patch }));

  async function save() {
    const whenDate = when ? new Date(when) : new Date();
    const res = validateLog(kind, { ...f, note, loggedAt: Number.isNaN(whenDate.getTime()) ? 'invalid' : whenDate.toISOString() });
    if (!res.ok) {
      setErrors(res.errors);
      const first = Object.keys(res.errors)[0];
      document.getElementById(`hl-${first}`)?.focus();
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const saved = await saveHealthLog(res.row, row?.id);
      const text = `${k.label}: ${formatLog(saved, { weightUnit: saved.unit === 'lb' || saved.unit === 'kg' ? saved.unit : weightUnit })}, ${whenWords(saved.logged_at)}`;
      ui.toast(editing ? `Updated. ${text}.` : `Saved. ${text}.`, 'good', editing ? null : {
        label: 'Undo',
        onAction: async () => {
          try { await deleteHealthLog(saved.id); ui.toast('Undone. That entry was removed.', 'info'); onSaved(); }
          catch { ui.toast('Could not undo.', 'bad'); }
        },
      });
      onSaved();
    } catch (e) {
      ui.toast(e.message || 'Could not save. Nothing was recorded.', 'bad');
      setBusy(false);
    }
  }

  const err = (id) => (errors[id] ? <span className="field__err" id={`hl-${id}-err`} role="alert">{errors[id]}</span> : null);
  const aria = (id) => ({ id: `hl-${id}`, 'aria-invalid': errors[id] ? 'true' : undefined, 'aria-describedby': errors[id] ? `hl-${id}-err` : undefined });

  return (
    <Modal title={editing ? `Edit ${k.label.toLowerCase()}` : k.logLabel} onClose={onClose}
      footer={(
        <div className="btn-row">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} icon={busy ? 'clock' : undefined} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      )}>
      {kind === 'water' && (
        <>
          <UnitChoice label="Unit" value={f.unit} onChange={(unit) => set({ unit })} options={[{ value: 'glass', label: 'Glasses' }, { value: 'ml', label: 'Millilitres (ml)' }]} />
          <label className="field"><span className="field__label">{f.unit === 'ml' ? 'Amount in ml' : 'Number of glasses'}</span>
            <Input inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} {...aria('amount')} />
            {err('amount')}</label>
        </>
      )}
      {kind === 'sleep' && (
        <div className="hl-pair">
          <label className="field"><span className="field__label">Hours</span>
            <Input inputMode="numeric" value={f.hours} onChange={(e) => set({ hours: e.target.value })} {...aria('hours')} />
            {err('hours')}</label>
          <label className="field"><span className="field__label">Minutes</span>
            <Input inputMode="numeric" value={f.minutes} onChange={(e) => set({ minutes: e.target.value })} {...aria('minutes')} />
            {err('minutes')}</label>
        </div>
      )}
      {kind === 'weight' && (
        <>
          <UnitChoice label="Unit" value={f.unit} onChange={(unit) => set({ unit })} options={[{ value: 'kg', label: 'Kilograms (kg)' }, { value: 'lb', label: 'Pounds (lb)' }]} />
          <label className="field"><span className="field__label">Weight in {f.unit === 'lb' ? 'pounds' : 'kilograms'}</span>
            <Input inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} {...aria('amount')} />
            {err('amount')}</label>
        </>
      )}
      {kind === 'blood_pressure' && (
        <>
          <div className="hl-pair">
            <label className="field"><span className="field__label">Top number (systolic)</span>
              <Input inputMode="numeric" value={f.systolic} onChange={(e) => set({ systolic: e.target.value })} {...aria('systolic')} />
              {err('systolic')}</label>
            <label className="field"><span className="field__label">Bottom number (diastolic)</span>
              <Input inputMode="numeric" value={f.diastolic} onChange={(e) => set({ diastolic: e.target.value })} {...aria('diastolic')} />
              {err('diastolic')}</label>
          </div>
          <p className="muted hl-unit">Measured in mmHg, as shown on your monitor.</p>
        </>
      )}
      {kind === 'heart_rate' && (
        <label className="field"><span className="field__label">Beats per minute (bpm)</span>
          <Input inputMode="numeric" value={f.bpm} onChange={(e) => set({ bpm: e.target.value })} {...aria('bpm')} />
          {err('bpm')}</label>
      )}
      <label className="field"><span className="field__label">When</span>
        <Input type="datetime-local" value={when} max={localInputValue()} onChange={(e) => setWhen(e.target.value)} {...aria('loggedAt')} />
        {err('loggedAt')}</label>
      <label className="field"><span className="field__label">Note (optional)</span>
        <Textarea rows={2} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} {...aria('note')} />
        {err('note')}</label>
    </Modal>
  );
}

function initialFields(kind, row, weightUnit) {
  if (kind === 'water') return { unit: row?.unit || 'glass', amount: row ? String(Number(row.value)) : '' };
  if (kind === 'sleep') return row ? { hours: String(Math.floor(row.value / 60)), minutes: String(Math.round(row.value % 60)) } : { hours: '', minutes: '' };
  if (kind === 'weight') {
    const unit = row?.unit || weightUnit || 'kg';
    return { unit, amount: row ? String(unit === 'lb' ? kgToLb(Number(row.value)) : Number(row.value)) : '' };
  }
  if (kind === 'blood_pressure') return { systolic: row ? String(Number(row.value)) : '', diastolic: row ? String(Number(row.value2)) : '' };
  return { bpm: row ? String(Number(row.value)) : '' };
}

function UnitChoice({ label, value, onChange, options }) {
  return (
    <div className="field">
      <span className="field__label" id="hl-unit-l">{label}</span>
      <SegmentedControl label={label} value={value} onChange={onChange} options={options} />
    </div>
  );
}

// Mood is kept where it always was: as a note in the health diary, so the
// tracker, Home and the diary all show the same answer.
function MoodPicker({ current, onClose, onSaved }) {
  const ui = useUI();
  const [busy, setBusy] = useState(null);
  async function pick(m) {
    setBusy(m.id);
    const prev = current?.entry;
    try {
      await saveDiary({ id: prev?.id, category: m.category, title: m.title, body: prev?.body, entry_at: prev?.entry_at });
      ui.toast(`Saved to your health diary: ${m.title.toLowerCase()}.`, 'good');
      onSaved();
    } catch { ui.toast('Could not save. Please try again.', 'bad'); setBusy(null); }
  }
  return (
    <Modal title="How are you feeling today?" onClose={onClose}>
      <div className="mood-grid" role="group" aria-label="Mood">
        {MOODS.map((m) => (
          <button key={m.id} type="button" className={`mood mood--${m.id}${current?.mood.id === m.id ? ' is-on' : ''}`}
            aria-pressed={current?.mood.id === m.id} disabled={!!busy} onClick={() => pick(m)}>
            <span className="mood__ic"><Icon name={busy === m.id ? 'clock' : m.icon} size={24} /></span>
            <span className="mood__l">{m.label}</span>
          </button>
        ))}
      </div>
      <p className="muted" style={{ margin: '12px 0 0' }}>One tap saves it to your health diary.</p>
    </Modal>
  );
}

// Trends: one measurement at a time, one bar per day. A day with no entry is
// an empty slot labelled "No entry" — never a zero-height bar that reads as
// a value. Every bar's number is written out, so the chart is not needed to
// read it, and the full list below can be corrected or deleted.
function Trends({ logs, weightUnit, onEdit, onDelete, onLog }) {
  const [kind, setKind] = useState('sleep');
  const [days, setDays] = useState(7);
  const k = kindInfo(kind);
  const today = localDateStr();
  const waterUnit = useMemo(() => {
    const w = logs.filter((r) => r.kind === 'water');
    return w.filter((r) => r.unit === 'ml').length > w.length / 2 ? 'ml' : 'glass';
  }, [logs]);
  const series = dailySeries(logs, kind, { endIso: today, days, dayOf, unit: waterUnit });
  const max = Math.max(1, ...series.points.map((p) => p.value || 0));
  const rows = logs.filter((r) => r.kind === kind).slice(0, 60);
  const label = (p) => {
    if (p.value == null) return null;
    if (kind === 'sleep') return sleepWords(p.value);
    if (kind === 'water') return waterUnit === 'ml' ? `${p.value} ml` : `${p.value}`;
    if (kind === 'blood_pressure') return `${p.value}/${p.value2}`;
    if (kind === 'weight') return weightUnit === 'lb' ? `${kgToLb(p.value)}` : `${p.value}`;
    return `${p.value}`;
  };
  const unitWords = kind === 'sleep' ? 'time asleep, total per day'
    : kind === 'water' ? `${waterUnit === 'ml' ? 'millilitres' : 'glasses'}, total per day`
      : kind === 'blood_pressure' ? 'mmHg, last reading of the day'
        : kind === 'weight' ? `${weightUnit}, last reading of the day` : 'beats per minute, last reading of the day';
  const avg = kind === 'sleep' ? averageOf(series.points) : null;

  return (
    <>
      <div className="field">
        <label className="field__label" htmlFor="trend-kind">Measurement</label>
        <select id="trend-kind" className="input input--select" value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </div>
      <SegmentedControl label="Period" value={String(days)} onChange={(v) => setDays(Number(v))} options={[
        { value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' },
      ]} />

      <section className="card htrend" aria-labelledby="trend-t">
        <h3 className="htrend__t" id="trend-t">{k.label}</h3>
        <p className="htrend__sub">{unitWords}. Logged on {series.daysWithData} of {days} days.</p>
        {series.daysWithData === 0 ? (
          <div className="htrend__empty">
            <p>No {k.label.toLowerCase()} entries in this period.</p>
            <Button variant="ghost" icon="plus" onClick={() => onLog(kind)}>{k.logLabel}</Button>
          </div>
        ) : (
          <ol className={`bars bars--${days}`} aria-label={`${k.label}, one item per day`}>
            {series.points.map((p) => {
              const d = new Date(`${p.day}T12:00:00`);
              const dayLabel = d.toLocaleDateString([], { weekday: 'short' });
              const full = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
              const v = label(p);
              return (
                <li key={p.day} className={`bars__col${p.value == null ? ' is-empty' : ''}`}>
                  <span className="sr-only">{full}: {v ? `${v}${kind === 'blood_pressure' ? ' mmHg' : ''}` : 'no entry'}</span>
                  <span className="bars__v" aria-hidden="true">{v || '—'}</span>
                  <span className="bars__track" aria-hidden="true">
                    {p.value != null && <span className="bars__fill" style={{ height: `${Math.max(8, Math.round((p.value / max) * 100))}%` }} />}
                  </span>
                  <span className="bars__d" aria-hidden="true">{days <= 7 ? dayLabel : d.getDate()}</span>
                </li>
              );
            })}
          </ol>
        )}
        {series.daysWithData > 0 && <p className="htrend__key">A dash (—) means no entry that day. Nothing is filled in for you.</p>}
        {avg != null && <p className="htrend__avg">Average on the {series.daysWithData} day{series.daysWithData === 1 ? '' : 's'} logged: <b>{sleepWords(avg)}</b></p>}
        {kind === 'water' && series.otherUnit > 0 && (
          <p className="htrend__key">{series.otherUnit} entr{series.otherUnit === 1 ? 'y' : 'ies'} in {waterUnit === 'ml' ? 'glasses' : 'millilitres'} {series.otherUnit === 1 ? 'is' : 'are'} in the list below but not in the chart, because the two units cannot be added together.</p>
        )}
      </section>

      <section className="stack" aria-labelledby="hist-t">
        <h3 className="settings-group" id="hist-t">{k.label} entries</h3>
        {rows.length ? (
          <ul className="rd-list hist">
            {rows.map((r) => (
              <li key={r.id} className="hist__row">
                <div className="hist__main">
                  <span className="hist__v">{formatLog(r, { weightUnit: kind === 'weight' ? weightUnit : undefined })}</span>
                  <span className="hist__when">{prettyDate(dayOf(r.logged_at))}, {prettyClock(new Date(r.logged_at))}</span>
                  {r.note && <span className="hist__note">{r.note}</span>}
                </div>
                <button type="button" className="icon-btn" aria-label={`Edit ${k.label.toLowerCase()} entry, ${formatLog(r)}, ${whenWords(r.logged_at)}`} onClick={() => onEdit(r)}><Icon name="edit" size={20} /></button>
                <button type="button" className="icon-btn" aria-label={`Delete ${k.label.toLowerCase()} entry, ${formatLog(r)}, ${whenWords(r.logged_at)}`} onClick={() => onDelete(r)}><Icon name="trash" size={20} /></button>
              </li>
            ))}
          </ul>
        ) : <p className="muted" style={{ margin: 0 }}>Nothing logged yet.</p>}
      </section>
    </>
  );
}
