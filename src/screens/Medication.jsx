import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useUI } from '../context/UIContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Button, EmptyState, HeroEmpty, TipCard, SegmentedControl, SkeletonCard } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { MedCalendar } from '../components/MedCalendar.jsx';
import { MedicineWizard } from '../components/MedicineWizard.jsx';
import { useApp } from '../context/AppContext.jsx';
import {
  listMedications, deleteMedication, restoreMedication, duplicateMedication,
  todaysDoses, dosesForDate, dosesInRange, markDoseTaken, markDoseSkipped, markDosePending, medPhotoUrl,
} from '../lib/db.js';
import { prettyTime, prettyClock, prettyDate, localDateStr } from '../lib/format.js';
import { doseState, sortForDisplay, summarise, adherence, STATE_UI } from '../lib/doseState.js';
import { describeSchedule } from '../lib/schedule.js';

export default function Medication() {
  const ui = useUI();
  const { profile } = useApp();
  // The person's own missed-dose window decides when pending becomes missed.
  const windowMinutes = profile?.alert_window_minutes ?? 60;
  const location = useLocation();
  // Home's calendar links here with { view: 'calendar', day } to open a day's history.
  const [view, setView] = useState(() => location.state?.view || 'today');
  const [editing, setEditing] = useState(null);
  const [selectedDay, setSelectedDay] = useState(() => location.state?.day || localDateStr());

  const meds = useAsync(() => listMedications(), []);
  const today = useAsync(() => todaysDoses(), []);

  useEffect(() => {
    if (location.state?.add === 'med') { setView('medicines'); setEditing({}); window.history.replaceState({}, ''); }
    else if (location.state?.view) {
      setView(location.state.view);
      if (location.state.day) setSelectedDay(location.state.day);
      window.history.replaceState({}, '');
    }
  }, [location.key]);

  function reloadAll() { meds.reload(); today.reload(); }
  async function done(id) { try { await markDoseTaken(id); ui.toast('Marked as taken.'); today.reload(); } catch { ui.toast('Could not save.', 'bad'); } }
  // "Not today" is a settled decision, so it offers Undo rather than a
  // confirmation: tapping it by mistake must not need a dialog to escape.
  async function skip(id, reason) {
    try {
      await markDoseSkipped(id, reason);
      today.reload();
      ui.toast('Marked as not needed today.', 'info', {
        label: 'Undo',
        onAction: async () => {
          try { await markDosePending(id); today.reload(); } catch { ui.toast('Could not undo.', 'bad'); }
        },
      });
    } catch { ui.toast('Could not save.', 'bad'); }
  }

  // Removing is a soft delete, so Undo is a flag flip rather than a re-entry
  // of everything they typed. The dose history keeps pointing at the row.
  async function remove(m) {
    const ok = await ui.confirm({
      title: `Remove ${m.name}?`,
      message: 'It will stop appearing in your day. Your past doses are kept.',
      confirmLabel: 'Remove', danger: true,
    });
    if (!ok) return;
    try {
      await deleteMedication(m.id);
      reloadAll();
      ui.toast(`${m.name} removed.`, 'info', {
        label: 'Undo',
        onAction: async () => {
          try { await restoreMedication(m.id); reloadAll(); ui.toast(`${m.name} is back.`); }
          catch { ui.toast('Could not undo.', 'bad'); }
        },
      });
    } catch { ui.toast('Could not remove.', 'bad'); }
  }

  // For a medicine taken at two strengths or on a different schedule: copy it
  // and open the copy, so the second one is a few taps rather than a retype.
  async function duplicate(m) {
    try {
      const id = await duplicateMedication(m);
      const fresh = await listMedications();
      reloadAll();
      const copy = fresh.find((x) => x.id === id);
      if (copy) setEditing(copy);
      ui.toast('Copied — change what is different.');
    } catch { ui.toast('Could not copy that medicine.', 'bad'); }
  }

  return (
    <div className="stack">
      <SegmentedControl value={view} onChange={setView} options={[
        { value: 'today', label: 'Today' },
        { value: 'calendar', label: 'History' },
        { value: 'medicines', label: 'Medicines' },
      ]} />

      {view === 'today' && <TodayView state={today} onDone={done} onSkip={skip} windowMinutes={windowMinutes}
        onAdd={() => { setView('medicines'); setEditing({}); }} />}

      {view === 'calendar' && (
        <>
          <AdherenceSummary windowMinutes={windowMinutes} />
          <p className="muted" style={{ margin: 0 }}>Tap any day to see which doses were taken.</p>
          <MedCalendar selected={selectedDay} onPick={setSelectedDay} />
          <h3 className="subsection">{prettyDate(selectedDay)}</h3>
          <DayDoses dateStr={selectedDay} windowMinutes={windowMinutes} />
        </>
      )}

      {view === 'medicines' && (
        <MedicinesView state={meds} onAdd={() => setEditing({})} onEdit={setEditing}
          onRemove={remove} onDuplicate={duplicate} />
      )}

      {editing && <MedicineWizard med={editing.id ? editing : null} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); reloadAll(); }} />}
    </div>
  );
}

function TodayView({ state, onDone, onSkip, onAdd, windowMinutes }) {
  const { data: doses, loading, error, reload } = state;
  if (loading) return <div className="stack"><SkeletonCard lines={2} /><SkeletonCard lines={2} /></div>;
  if (error) return <Card className="center"><p className="lead">Could not load.</p><Button onClick={reload}>Try again</Button></Card>;
  if (!doses.length) {
    return (
      <div className="stack">
        <HeroEmpty icon="pill" title="No doses scheduled today"
          action={<Button icon="plus" onClick={onAdd}>Add a medicine</Button>}>
          When you add a medicine and its times, today's doses will appear here.
        </HeroEmpty>
        <TipCard>Set reminders for your medicines so you never miss a dose.</TipCard>
      </div>
    );
  }
  const summary = summarise(doses, { windowMinutes });
  return (
    <div className="stack">
      <p className="today__headline" aria-live="polite">{summary.headline}</p>
      {/* What needs doing first, then the rest by time. */}
      {sortForDisplay(doses, { windowMinutes }).map((d) => (
        <DoseCard key={d.id} dose={d} onDone={onDone} onSkip={onSkip} windowMinutes={windowMinutes} />
      ))}
    </div>
  );
}

// How the last week and month actually went, in a sentence rather than a
// number. "You took 19 of 21 doses" is something a person can repeat to their
// doctor; "90%" is a mark out of a hundred, and this is not a test.
function AdherenceSummary({ windowMinutes }) {
  const range = useMemo(() => {
    const today = localDateStr();
    const back = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return localDateStr(undefined, d); };
    return { today, week: back(6), month: back(29) };
  }, []);
  const { data, loading, error } = useAsync(() => dosesInRange(range.month, range.today), [range.month, range.today]);

  if (loading) return <SkeletonCard lines={2} />;
  // A summary is not worth an error message of its own; the calendar below
  // still works, so failing quietly beats shouting about it.
  if (error || !data.length) return null;

  const opts = { windowMinutes };
  const week = adherence(data.filter((d) => d.dose_date >= range.week), opts);
  const month = adherence(data, opts);
  if (!week.total && !month.total) return null;

  // One decision, used by both the badge and the bar, so they cannot disagree.
  const tone = week.pct == null || week.pct >= 90 ? { badge: 'taken', fill: '' }
    : week.pct >= 70 ? { badge: 'overdue', fill: ' bar__fill--warn' }
      : { badge: 'missed', fill: ' bar__fill--bad' };

  return (
    <Card>
      <div className="adh__head">
        <h3 className="adh__title">Your last 7 days</h3>
        {week.pct != null && <span className={`g-badge g-badge--${tone.badge}`}>{week.pct}%</span>}
      </div>
      <p className="adh__line">
        {week.total
          ? <>You took <b>{week.taken} of {week.total}</b> {week.total === 1 ? 'dose' : 'doses'}.</>
          : 'No doses were due in the last 7 days.'}
      </p>
      {week.pct != null && (
        <div className="bar" role="img" aria-label={`${week.pct} per cent of doses taken in the last 7 days`}>
          <div className={`bar__fill${tone.fill}`} style={{ width: `${week.pct}%` }} />
        </div>
      )}
      {month.total > week.total && (
        <p className="adh__sub">Over 30 days: {month.taken} of {month.total} doses{month.pct != null ? ` (${month.pct}%)` : ''}.</p>
      )}
    </Card>
  );
}

function DayDoses({ dateStr, windowMinutes }) {
  const { data, loading } = useAsync(() => dosesForDate(dateStr), [dateStr]);
  if (loading) return <SkeletonCard lines={2} />;
  if (!data.length) return <EmptyState icon="calendar">No doses were recorded for this day.</EmptyState>;
  return (
    <div className="stack">
      {data.map((d) => <DoseCard key={d.id} dose={d} readOnly windowMinutes={windowMinutes} />)}
    </div>
  );
}

// State comes from doseState(), the same function Home and the guardian
// dashboard use, so the badge here can no longer disagree with the counters
// there. It also means 'overdue' exists at all: a dose twenty minutes late
// used to render exactly like one due tonight.
function DoseCard({ dose, onDone, onSkip, readOnly, windowMinutes }) {
  const [asking, setAsking] = useState(false);
  const m = dose.medication || {};
  const st = doseState(dose, { windowMinutes });
  const ui = STATE_UI[st];
  const color = m.color || '#2563a8';

  return (
    <Card accent={ui.tone}>
      <div className="dose">
        <span className="dose__chip" style={{ background: color }} aria-hidden="true"><Icon name="pill" size={20} /></span>
        <div className="dose__main">
          <div className="card__title">{m.name || 'Medicine'}</div>
          {m.dose && <div className="medrow__dose">{m.dose}</div>}
          <div className="card__meta">Scheduled for {prettyTime(dose.scheduled_time)}</div>
          {st === 'taken' && dose.taken_at && (
            <div className="dose__when">Marked taken at {prettyClock(new Date(dose.taken_at))}</div>
          )}
          {m.note && <div className="card__meta">{m.note}</div>}
        </div>
        {/* Colour plus an icon plus a word, never colour alone. */}
        <span className={`g-badge g-badge--${ui.tone}`}>
          <Icon name={ui.icon} size={16} /> {ui.label}
        </span>
      </div>
      {st === 'skipped' && (
        <div className="dose__when dose__when--skip">{dose.skip_reason ? `Not today: ${dose.skip_reason}` : 'Marked as not needed today'}</div>
      )}

      {/* The big button never moves or shrinks: taking the dose stays the one
          obvious action, and "Not today" is deliberately quieter beneath it. */}
      {!readOnly && st !== 'taken' && st !== 'skipped' && !asking && (
        <>
          <Button variant="good" size="lg" icon="check" onClick={() => onDone(dose.id)}>Done - I took it</Button>
          <button type="button" className="dose__skip" onClick={() => setAsking(true)}>
            <Icon name="minus" size={18} /> Not today
          </button>
        </>
      )}

      {!readOnly && asking && (
        <div className="dose__why">
          <p className="dose__whyq" id={`why-${dose.id}`}>Why not today?</p>
          <div className="dose__reasons" role="group" aria-labelledby={`why-${dose.id}`}>
            {SKIP_REASONS.map((r) => (
              <button type="button" key={r} className="dose__reason"
                onClick={() => { setAsking(false); onSkip(dose.id, r); }}>{r}</button>
            ))}
            <button type="button" className="dose__reason"
              onClick={() => { setAsking(false); onSkip(dose.id, ''); }}>Another reason</button>
          </div>
          <button type="button" className="dose__skip" onClick={() => setAsking(false)}>Never mind</button>
        </div>
      )}
    </Card>
  );
}

// Fixed choices, not a text box. A free-text field is how a medicine ends up
// recorded as "dafs", and none of these need spelling or typing.
const SKIP_REASONS = ['Doctor said to stop', 'I felt unwell', 'I ran out', 'I took it already'];

function MedicinesView({ state, onAdd, onEdit, onRemove, onDuplicate }) {
  const { data: meds, loading, error, reload } = state;
  if (loading) return <div className="stack"><SkeletonCard lines={2} /><SkeletonCard lines={2} /></div>;
  if (error) return <Card className="center"><p className="lead">Could not load.</p><Button onClick={reload}>Try again</Button></Card>;
  return (
    <div className="stack">
      {!meds.length && (
        <HeroEmpty icon="pill" title="No medicines yet"
          action={<Button icon="plus" onClick={onAdd}>Add your first medicine</Button>}>
          Add your medicines and vitamins with the times you take them, and MyDay will remind you every day.
        </HeroEmpty>
      )}
      {meds.map((m) => (
        <MedicineCard key={m.id} med={m} onEdit={onEdit} onRemove={onRemove} onDuplicate={onDuplicate} />
      ))}
      <Button icon="plus" onClick={onAdd}>Add a medicine</Button>
    </div>
  );
}

// The list card now shows everything the wizard asked for — dose, the times,
// how often, and the photo — instead of just "name - dose" and a time list.
// A photo is the fastest way to tell two similar white tablets apart.
function MedicineCard({ med: m, onEdit, onRemove, onDuplicate }) {
  const [photo, setPhoto] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!m.photo_path) { setPhoto(null); return; }
    // Private bucket, so this is a short-lived signed URL, not a public link.
    medPhotoUrl(m.photo_path).then((u) => { if (alive) setPhoto(u); }).catch(() => {});
    return () => { alive = false; };
  }, [m.photo_path]);

  const asNeeded = m.frequency === 'as_needed';

  return (
    <Card>
      <div className="medrow">
        {photo
          ? <img className="medrow__photo" src={photo} alt={`${m.name}, as photographed`} />
          : <span className="dose__chip" style={{ background: m.color || '#2563a8' }}><Icon name="pill" size={20} /></span>}
        <div className="medrow__main">
          <div className="card__title">{m.name}</div>
          {m.dose && <div className="medrow__dose">{m.dose}</div>}
          <div className="medrow__meta">
            <span className="medrow__tag">
              <Icon name="clock" size={15} />
              {asNeeded ? 'When needed' : ((m.times || []).map(prettyTime).join(', ') || 'No times set')}
            </span>
            <span className="medrow__tag">
              <Icon name="calendar" size={15} />
              {describeSchedule({ ...m, times: [] }, { prettyTime }).replace(' at no set time', '')}
            </span>
            {m.with_food && <span className="medrow__tag"><Icon name="star" size={15} /> With food</span>}
          </div>
          {m.note && <div className="card__meta">{m.note}</div>}
          {!m.reminders_enabled && (
            <div className="medrow__off"><Icon name="bell" size={15} /> Reminders off for this one</div>
          )}
        </div>
      </div>
      <div className="btn-row">
        <Button variant="ghost" size="sm" icon="edit" onClick={() => onEdit(m)}>Edit</Button>
        <Button variant="ghost" size="sm" icon="plus" onClick={() => onDuplicate(m)}>Copy</Button>
        <Button variant="danger" size="sm" icon="trash" onClick={() => onRemove(m)}>Remove</Button>
      </div>
    </Card>
  );
}
