import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useUI } from '../context/UIContext.jsx';
import { useDayRefresh } from '../hooks/useDayRefresh.js';
import { useAsync } from '../hooks/useAsync.js';
import { useDoseActions } from '../hooks/useDoseActions.js';
import { Card, Button, EmptyState, HeroEmpty, TipCard, SegmentedControl, TabPanel, SkeletonCard, Input, Modal, Field } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { MedCalendar } from '../components/MedCalendar.jsx';
import { MedicineWizard, TimePicker } from '../components/MedicineWizard.jsx';
import { MedicineBatch } from '../components/MedicineBatch.jsx';
import { MedicineInsights } from '../components/MedicineInsights.jsx';
import { useApp } from '../context/AppContext.jsx';
import {
  listMedications, deleteMedication, restoreMedication, copyOfMedication,
  todaysDoses, dosesForDate, dosesInRange, medPhotoUrl, listContacts, recordRefill,
} from '../lib/db.js';
import { prettyTime, prettyClock, prettyDate, localDateStr } from '../lib/format.js';
import { doseState, sortForDisplay, summarise, adherence, canMarkTaken, unlocksAt, STATE_UI } from '../lib/doseState.js';
import { medIcon } from '../lib/medIcon.js';
import { DoseHistory } from '../components/DoseHistory.jsx';
import { describeSchedule, isDueOn, normaliseTimes } from '../lib/schedule.js';
import { selectMedicines } from '../lib/medicineList.js';
import { describeDoseWithStrength, ROUTES, UNITS, parseAmountInput } from '../lib/doseUnits.js';
import { supplyEstimate, supplyWords } from '../lib/inventory.js';

const TABS = 'medtabs';

export default function Medication() {
  const ui = useUI();
  const { profile, user } = useApp();
  // The person's own missed-dose window decides when pending becomes missed.
  const windowMinutes = profile?.alert_window_minutes ?? 60;
  const location = useLocation();
  // Home's calendar links here with { view: 'calendar', day } to open a day's history.
  const [view, setView] = useState(() => location.state?.view || 'today');
  const [editing, setEditing] = useState(null);
  const [copying, setCopying] = useState(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState(() => location.state?.day || localDateStr());
  // History opens as a list; Home's calendar links straight to a day, so that
  // arrives in calendar mode.
  const [historyMode, setHistoryMode] = useState(() => (location.state?.day ? 'calendar' : 'list'));

  const meds = useAsync(() => listMedications(), []);
  const today = useAsync(() => todaysDoses(), []);

  useEffect(() => {
    if (location.state?.add === 'med') { setView('medicines'); setBatchOpen(true); window.history.replaceState({}, ''); }
    else if (location.state?.view) {
      setView(location.state.view);
      if (location.state.day) { setSelectedDay(location.state.day); setHistoryMode('calendar'); }
      window.history.replaceState({}, '');
    }
  }, [location.key]);

  const reloadAll = useCallback(() => { meds.reload(); today.reload(); }, [meds.reload, today.reload]);
  useDayRefresh(reloadAll);
  const actions = useDoseActions(reloadAll);

  // Removing is a soft delete, so Undo is a flag flip rather than a re-entry
  // of everything they typed. The dose history keeps pointing at the row, and
  // the confirmation names the exact medicine and what will happen.
  async function remove(m) {
    const ok = await ui.confirm({
      title: `Remove ${m.name}${m.dose ? ` (${m.dose})` : ''}?`,
      message: 'It stops appearing in your day and stops reminders. Doses you already recorded are kept in your history. You can undo this straight after.',
      confirmLabel: `Remove ${m.name}`, danger: true,
    });
    if (!ok) return;
    try {
      await deleteMedication(m.id);
      setEditing(null);
      reloadAll();
      ui.toast(`${m.name} removed.`, 'info', {
        label: 'Undo',
        onAction: async () => {
          try { await restoreMedication(m.id); reloadAll(); ui.toast(`${m.name} is back.`); }
          catch { ui.toast('Could not undo.', 'bad'); }
        },
      });
    } catch (e) { ui.toast(e.message || 'Could not remove.', 'bad'); }
  }

  return (
    <div className="stack">
      <SegmentedControl kind="tabs" idBase={TABS} label="Medication views" value={view} onChange={setView} options={[
        { value: 'today', label: 'Today' },
        { value: 'calendar', label: 'History' },
        { value: 'medicines', label: 'Medicines' },
      ]} />

      <TabPanel idBase={TABS} value={view}>
        {view === 'today' && <TodayView state={today} meds={meds.data || []} actions={actions} windowMinutes={windowMinutes}
          onAdd={() => { setView('medicines'); setBatchOpen(true); }} />}

        {view === 'calendar' && (
          <div className="stack">
            <AdherenceSummary windowMinutes={windowMinutes} />
            <SegmentedControl label="Show history as" value={historyMode} onChange={setHistoryMode} options={[
              { value: 'list', label: 'List' },
              { value: 'calendar', label: 'Calendar' },
            ]} />
            {historyMode === 'list' ? <DoseHistory windowMinutes={windowMinutes} /> : (
              <>
                <p className="muted" style={{ margin: 0 }}>Past days show what was recorded. Future days show what is planned.</p>
                <MedCalendar selected={selectedDay} onPick={setSelectedDay} windowMinutes={windowMinutes} meds={meds.data || []} />
                <h3 className="subsection">{prettyDate(selectedDay)}</h3>
                <DayDoses dateStr={selectedDay} windowMinutes={windowMinutes} meds={meds.data || []} />
              </>
            )}
          </div>
        )}

        {view === 'medicines' && (
          <MedicinesView state={meds} onAdd={() => setBatchOpen(true)} onEdit={setEditing}
            onRemove={remove} onDuplicate={(m) => setCopying(m)} onChanged={reloadAll} />
        )}
      </TabPanel>

      {editing && <MedicineWizard med={editing} onClose={() => setEditing(null)} onRemove={remove}
        onSaved={() => { setEditing(null); reloadAll(); }} />}
      {/* A copy is reviewed before it exists: nothing is saved until confirmed. */}
      {copying && <MedicineWizard prefill={{ form: copyOfMedication(copying), copiedFrom: copying.name }}
        onClose={() => setCopying(null)} onSaved={() => { setCopying(null); reloadAll(); }} />}
      {batchOpen && <MedicineBatch userId={user?.id} onClose={() => setBatchOpen(false)}
        onSaved={() => { setBatchOpen(false); reloadAll(); }} />}
    </div>
  );
}

function TodayView({ state, meds, actions, onAdd, windowMinutes }) {
  const { data: doses, loading, error, reload } = state;
  const asNeeded = meds.filter((m) => m.frequency === 'as_needed');
  if (loading) return <div className="stack"><SkeletonCard lines={2} /><SkeletonCard lines={2} /></div>;
  if (error) return <Card className="center"><p className="lead">Could not load today's doses.</p><Button onClick={reload}>Try again</Button></Card>;
  const scheduled = doses.filter((d) => !d.as_needed);
  const prnLog = doses.filter((d) => d.as_needed);
  if (!scheduled.length && !asNeeded.length) {
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
  const summary = summarise(scheduled, { windowMinutes });
  return (
    <div className="stack">
      {!!scheduled.length && <p className="today__headline" aria-live="polite">{summary.headline}</p>}
      {/* What needs doing first, then the rest by time. */}
      {sortForDisplay(scheduled, { windowMinutes }).map((d) => (
        <DoseCard key={d.id} dose={d} actions={actions} windowMinutes={windowMinutes} />
      ))}
      {!!asNeeded.length && (
        <section className="stack" aria-labelledby="prn-h">
          <h3 className="subsection" id="prn-h">Only when needed</h3>
          {asNeeded.map((m) => (
            <AsNeededCard key={m.id} med={m} taken={prnLog.filter((d) => d.medication_id === m.id)} actions={actions} />
          ))}
        </section>
      )}
    </div>
  );
}

// An as-needed medicine is never "due", so it has no reminder and is never
// missed. It can be logged when it is taken, and today's entries are listed
// so a second tap is a visible, deliberate choice.
function AsNeededCard({ med: m, taken, actions }) {
  const [earlier, setEarlier] = useState(false);
  const busy = actions.pending.has(`prn:${m.id}`);
  return (
    <Card>
      <div className="dose">
        <span className="dose__chip" style={{ background: m.color || '#2563a8' }} aria-hidden="true"><Icon name={medIcon(m)} size={20} /></span>
        <div className="dose__main">
          <div className="dose__head">
            <div className="card__title" translate="no">{m.name}</div>
            <span className="g-badge g-badge--prn"><Icon name="info" size={16} /> {STATE_UI.prn.label}</span>
          </div>
          {m.dose && <div className="medrow__dose">{describeDoseWithStrength(m)}</div>}
          <div className="card__meta">
            {taken.length
              ? `Taken today at ${taken.map((d) => prettyClock(new Date(d.taken_at))).join(', ')}`
              : 'Not taken today'}
          </div>
        </div>
      </div>
      <Button variant="ghost" icon={busy ? 'clock' : 'check'} disabled={busy} onClick={() => actions.takeAsNeeded(m)}>
        {busy ? 'Saving…' : 'I took one just now'}
      </Button>
      <button type="button" className="dose__skip" onClick={() => setEarlier(true)} disabled={busy}>
        <Icon name="clock" size={18} /> I took one earlier
      </button>
      {earlier && (
        <TimePicker title={`When did you take ${m.name}?`} initial={nowHHMM()}
          onCancel={() => setEarlier(false)}
          onPick={(t) => { setEarlier(false); actions.takeAsNeeded(m, timeToday(t)); }} />
      )}
    </Card>
  );
}

const nowHHMM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
// Today at HH:MM, never in the future.
function timeToday(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(); d.setHours(h, m, 0, 0);
  return new Date(Math.min(d.getTime(), Date.now())).toISOString();
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
      <details className="adh__how">
        <summary>How is this worked out?</summary>
        <p>
          Counted: scheduled doses whose time has passed, as taken or missed. Not counted: doses still to come,
          doses marked “not today”, and “only when needed” medicines. A dose counts as missed once your
          missed-dose time ({windowMinutes} minutes) has passed without it being marked taken.
        </p>
      </details>
    </Card>
  );
}

function DayDoses({ dateStr, windowMinutes, meds }) {
  const { data, loading } = useAsync(() => dosesForDate(dateStr), [dateStr]);
  if (loading) return <SkeletonCard lines={2} />;
  const future = dateStr > localDateStr();
  if (future) {
    // The plan, not a record: built from the active schedules and labelled so.
    const plan = meds.filter((m) => isDueOn(m, dateStr))
      .flatMap((m) => normaliseTimes(m.times).map((t) => ({ m, t })))
      .sort((a, b) => a.t.localeCompare(b.t));
    if (!plan.length) return <EmptyState icon="calendar">Nothing is scheduled for this day.</EmptyState>;
    return (
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}><Icon name="info" size={16} /> Planned — these doses have not happened yet.</p>
        <ul className="g-list">
          {plan.map(({ m, t }) => (
            <li key={`${m.id}-${t}`} className="g-dose g-dose--upcoming">
              <span className="g-dose__chip" style={{ background: m.color || 'var(--primary)' }} aria-hidden="true"><Icon name={medIcon(m)} size={18} /></span>
              <div className="g-dose__main">
                <div className="g-dose__name" translate="no">{m.name}</div>
                <div className="g-dose__meta"><span>{prettyTime(t)}</span>{m.dose && <span>{m.dose}</span>}</div>
              </div>
              <span className="g-badge g-badge--upcoming"><Icon name="calendar" size={16} /> Planned</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (!data.length) return <EmptyState icon="calendar">No doses were recorded for this day.</EmptyState>;
  return (
    <div className="stack">
      {data.map((d) => <DoseCard key={d.id} dose={d} readOnly windowMinutes={windowMinutes} />)}
    </div>
  );
}

// State comes from doseState(), the same function Home and the guardian
// dashboard use, so the badge here can no longer disagree with the counters
// there.
function DoseCard({ dose, actions, readOnly, windowMinutes }) {
  const [asking, setAsking] = useState(false);
  const [earlier, setEarlier] = useState(false);
  const m = dose.medication || {};
  const st = doseState(dose, { windowMinutes });
  const ui = STATE_UI[st];
  const color = m.color || '#2563a8';
  const markable = canMarkTaken(dose, { windowMinutes });
  const unlock = unlocksAt(dose);
  const busy = actions?.pending.has(dose.id);
  // What was recorded at the time, if the medicine has been edited since.
  const doseText = dose.dose_snapshot || m.dose;

  return (
    <Card accent={ui.tone}>
      <div className="dose">
        <span className="dose__chip" style={{ background: color }} aria-hidden="true"><Icon name={medIcon(m)} size={20} /></span>
        <div className="dose__main">
          <div className="dose__head">
            <div className="card__title" translate="no">{dose.name_snapshot || m.name || 'Medicine'}</div>
            {/* Colour plus an icon plus a word, never colour alone. */}
            <span className={`g-badge g-badge--${ui.tone}`}>
              <Icon name={ui.icon} size={16} /> {ui.label}
            </span>
          </div>
          {doseText && <div className="medrow__dose">{doseText}{m.strength ? ` · ${m.strength} strength` : ''}</div>}
          {/* The time is what tells this medicine's morning and evening
              cards apart, so it reads first rather than as small print. */}
          <div className="card__meta">Scheduled for <b className="dose__time">{prettyTime(dose.scheduled_time)}</b></div>
          {st === 'taken' && dose.taken_at && (
            <div className="dose__when">Taken at {prettyClock(new Date(dose.taken_at))}</div>
          )}
          {m.instructions && <div className="card__meta">{m.instructions}</div>}
          {m.note && <div className="card__meta">{m.note}</div>}
        </div>
      </div>
      {st === 'skipped' && (
        <div className="dose__when dose__when--skip">{dose.skip_reason ? `Not today: ${dose.skip_reason}` : 'Marked as not needed today'}</div>
      )}

      {/* The big button never moves or shrinks: taking the dose stays the one
          obvious action, and "Not today" is deliberately quieter beneath it. */}
      {!readOnly && st !== 'taken' && st !== 'skipped' && !asking && (
        <>
          {markable
            ? (
              <>
                <Button variant="good" size="lg" icon={busy ? 'clock' : 'check'} disabled={busy}
                  aria-label={`Done - I took it: ${m.name || 'this medicine'}, ${prettyTime(dose.scheduled_time)} dose`}
                  onClick={() => actions.take(dose)}>{busy ? 'Saving…' : 'Done - I took it'}</Button>
                <button type="button" className="dose__skip" disabled={busy} onClick={() => setEarlier(true)}>
                  <Icon name="clock" size={18} /> I took it earlier
                </button>
              </>
            )
            : (
              <div className="dose__locked">
                <Icon name="clock" size={18} />
                {unlock ? `You can mark this from ${prettyClock(unlock)}` : 'Not due yet'}
              </div>
            )}
          <button type="button" className="dose__skip" disabled={busy} onClick={() => setAsking(true)}>
            <Icon name="minus" size={18} /> Not today
          </button>
        </>
      )}
      {earlier && (
        <TimePicker title="When did you take it?" initial={dose.scheduled_time}
          onCancel={() => setEarlier(false)}
          onPick={(t) => { setEarlier(false); actions.take(dose, takenTimeFor(dose, t)); }} />
      )}

      {!readOnly && asking && (
        <div className="dose__why">
          <p className="dose__whyq" id={`why-${dose.id}`}>Why not today?</p>
          <div className="dose__reasons" role="group" aria-labelledby={`why-${dose.id}`}>
            {SKIP_REASONS.map((r) => (
              <button type="button" key={r} className="dose__reason"
                onClick={() => { setAsking(false); actions.skip(dose, r); }}>{r}</button>
            ))}
            <button type="button" className="dose__reason"
              onClick={() => { setAsking(false); actions.skip(dose, ''); }}>Another reason</button>
          </div>
          <button type="button" className="dose__skip" onClick={() => setAsking(false)}>Never mind</button>
        </div>
      )}
    </Card>
  );
}

// The chosen clock time on the dose's own day, never later than now.
function takenTimeFor(dose, hhmm) {
  const [y, mo, d] = dose.dose_date.split('-').map(Number);
  const [h, m] = hhmm.split(':').map(Number);
  const at = new Date(y, mo - 1, d, h, m, 0, 0).getTime();
  return new Date(Math.min(at, Date.now())).toISOString();
}

// Fixed choices, not a text box. "I already took it" is recorded as taken
// via "I took it earlier"; it is not a reason to skip.
const SKIP_REASONS = ['Doctor said to stop', 'I felt unwell', 'I ran out'];

function MedicinesView({ state, onAdd, onEdit, onRemove, onDuplicate, onChanged }) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('name');
  const contacts = useAsync(() => listContacts().catch(() => []), []);
  const { data: meds, loading, error, reload } = state;
  if (loading) return <div className="stack"><SkeletonCard lines={2} /><SkeletonCard lines={2} /></div>;
  if (error) return <Card className="center"><p className="lead">Could not load your medicines.</p><Button onClick={reload}>Try again</Button></Card>;
  const query = search.trim();
  const visible = selectMedicines(meds, query, sort);
  return (
    <div className="stack">
      {!meds.length && (
        <HeroEmpty icon="pill" title="No medicines yet"
          action={<Button icon="plus" onClick={onAdd}>Add medicines</Button>}>
          Type a medicine or scan its label. Review one or several before saving.
        </HeroEmpty>
      )}
      {!!meds.length && (
        <>
          <div className="medlist__toolbar">
            <div className="medlist__count" aria-live="polite">{query ? `${visible.length} of ${meds.length}` : meds.length} {meds.length === 1 ? 'medicine' : 'medicines'}</div>
            <Button icon="plus" full={false} onClick={onAdd}>Add medicines</Button>
          </div>
          {meds.length > 3 && (
            <div className="medlist__controls">
              <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search medicines" aria-label="Search medicines by name" />
              <select className="input medlist__sort" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort medicines">
                <option value="name">Name A–Z</option>
                <option value="time">Time of day</option>
                <option value="newest">Recently added</option>
              </select>
            </div>
          )}
          {visible.length ? (
            <ul className="medlist" aria-label="Your medicines">
              {visible.map((m) => <MedicineRow key={m.id} med={m} contacts={contacts.data || []} onEdit={onEdit}
                onRemove={onRemove} onDuplicate={onDuplicate} onChanged={onChanged} />)}
            </ul>
          ) : <EmptyState icon="search" title="No matching medicines">Try a different name or clear the search.</EmptyState>}
        </>
      )}
      <MedicineInsights meds={meds} />
    </div>
  );
}

const capitalise = (t) => t.charAt(0).toUpperCase() + t.slice(1);

function MedicineRow({ med: m, contacts, onEdit, onRemove, onDuplicate, onChanged }) {
  const [photo, setPhoto] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [refilling, setRefilling] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!m.photo_path) { setPhoto(null); return; }
    // Private bucket, so this is a short-lived signed URL, not a public link.
    medPhotoUrl(m.photo_path).then((u) => { if (alive) setPhoto(u); }).catch(() => {});
    return () => { alive = false; };
  }, [m.photo_path]);

  const asNeeded = m.frequency === 'as_needed';
  const schedule = capitalise(describeSchedule(m, { prettyTime }));
  const unitWord = m.dose_unit === 'other' ? (m.dose_other || 'left') : `${UNITS.find((u) => u.id === m.dose_unit)?.plural || 'doses'} left`;
  const supply = supplyWords(m, unitWord);
  const low = supplyEstimate(m).low;
  const route = ROUTES.find((r) => r.id === m.route)?.label;
  const pharmacy = contacts.find((c) => c.id === m.pharmacy_contact_id);
  const prescriber = contacts.find((c) => c.id === m.prescriber_contact_id);

  return (
    <li className="medlist__item">
      <div className="medlist__row">
        <button type="button" className="medlist__summary" aria-expanded={expanded}
          aria-controls={`medicine-details-${m.id}`} onClick={() => setExpanded((v) => !v)}>
          {photo ? <img className="medlist__photo" src={photo} alt="" />
            : <span className="medlist__icon" style={{ background: m.color || '#2563a8' }} aria-hidden="true"><Icon name={medIcon(m)} size={20} /></span>}
          <span className="medlist__main">
            <span className="medlist__name" translate="no">{m.name}</span>
            <span className="medlist__sub">{m.dose || 'No dose'} · {schedule}</span>
            {low && <span className="medlist__low"><Icon name="alert" size={15} /> Running low</span>}
          </span>
          <Icon name="chevron" size={20} className={expanded ? 'medlist__chevron is-open' : 'medlist__chevron'} />
        </button>
      </div>
      {expanded && <div className="medlist__details" id={`medicine-details-${m.id}`}>
          <div className="medrow__meta">
            <span className="medrow__tag">
              <Icon name="pill" size={15} />
              {describeDoseWithStrength(m) || 'No dose set'}
            </span>
            <span className="medrow__tag">
              <Icon name="clock" size={15} />
              {asNeeded ? 'When needed' : ((m.times || []).map(prettyTime).join(', ') || 'No times set')}
            </span>
            <span className="medrow__tag">
              <Icon name="calendar" size={15} />
              {capitalise(describeSchedule({ ...m, times: [], with_food: false }, { prettyTime }).replace(' at no set time', ''))}
            </span>
            {route && <span className="medrow__tag"><Icon name="info" size={15} /> {route}</span>}
            {m.with_food && <span className="medrow__tag"><Icon name="star" size={15} /> With food</span>}
          </div>
          {m.instructions && <div className="card__meta">{m.instructions}</div>}
          {m.note && <div className="card__meta">{m.note}</div>}
          {supply && <div className={`medrow__supply${low ? ' is-low' : ''}`}><Icon name={low ? 'alert' : 'pill'} size={16} /> {supply}</div>}
          {!m.reminders_enabled && (
            <div className="medrow__off"><Icon name="bell" size={15} /> Reminders off for this one</div>
          )}
          {(pharmacy || prescriber) && (
            <div className="medrow__contacts">
              {[['Pharmacy', pharmacy], ['Prescriber', prescriber]].filter(([, c]) => c).map(([role, c]) => (
                c.phone
                  ? <a key={role} className="btn btn--ghost btn--sm" href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}
                    aria-label={`Call ${role.toLowerCase()} ${c.name}, ${c.phone}`}>
                    <Icon name="phone" size={18} /> <span>Call {c.name}</span>
                  </a>
                  : <span key={role} className="muted">{role}: {c.name}</span>
              ))}
            </div>
          )}
          <div className="btn-row btn-row--wrap">
            <Button variant="ghost" size="sm" icon="edit" onClick={() => onEdit(m)} aria-label={`Edit ${m.name}`}>Edit</Button>
            <Button variant="ghost" size="sm" icon="plus" onClick={() => onDuplicate(m)} aria-label={`Copy ${m.name}`}>Copy</Button>
            {m.stock_quantity != null && (
              <Button variant="ghost" size="sm" icon="refresh" onClick={() => setRefilling(true)} aria-label={`Record a refill of ${m.name}`}>Refill</Button>
            )}
            <Button variant="danger" size="sm" icon="trash" onClick={() => onRemove(m)} aria-label={`Remove ${m.name}`}>Remove</Button>
          </div>
      </div>}
      {refilling && <RefillDialog med={m} onClose={() => setRefilling(false)} onDone={() => { setRefilling(false); onChanged(); }} />}
    </li>
  );
}

function RefillDialog({ med, onClose, onDone }) {
  const ui = useUI();
  const [qty, setQty] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    const r = parseAmountInput(qty);
    if (!r.ok) { setError(r.error.replace('how much you take each time', 'how many you got')); return; }
    setBusy(true);
    try {
      const out = await recordRefill(med.id, r.value);
      ui.toast(`Refill recorded for ${med.name}. ${out?.stock_quantity != null ? `${Number(out.stock_quantity)} now on hand.` : ''}`);
      onDone();
    } catch (e) { ui.toast(e.message || 'Could not save.', 'bad'); setBusy(false); }
  }
  return (
    <Modal title={`Refill ${med.name}`} onClose={onClose}
      footer={<Button icon="check" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Add to supply'}</Button>}>
      <Field label="How many did you get?" error={error} id="refill-qty">
        <Input id="refill-qty" type="text" inputMode="decimal" value={qty} onChange={(e) => { setQty(e.target.value); setError(''); }}
          aria-invalid={!!error} aria-describedby={error ? 'refill-qty-err' : undefined} />
      </Field>
    </Modal>
  );
}
