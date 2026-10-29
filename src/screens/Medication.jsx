import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useUI } from '../context/UIContext.jsx';
import { useDayRefresh } from '../hooks/useDayRefresh.js';
import { useAsync } from '../hooks/useAsync.js';
import { useDoseActions } from '../hooks/useDoseActions.js';
import { Card, Button, EmptyState, HeroEmpty, SegmentedControl, SkeletonCard, Input, Modal, Field, Toggle } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { MedCalendar } from '../components/MedCalendar.jsx';
import { DoseRow } from '../components/DoseRow.jsx';
import { MedicineWizard, TimePicker } from '../components/MedicineWizard.jsx';
import { MedicineBatch } from '../components/MedicineBatch.jsx';
import { MedicineInsights } from '../components/MedicineInsights.jsx';
import { useApp } from '../context/AppContext.jsx';
import {
  listMedications, deleteMedication, restoreMedication, copyOfMedication,
  todaysDoses, dosesForDate, dosesInRange, medPhotoUrl, listContacts, recordRefill, setMedicationReminders,
  getNotificationPrefs, saveNotificationPrefs,
} from '../lib/db.js';
import { deliveryStatus } from '../lib/notifications.js';
import { pushSupported } from '../lib/push.js';
import { platformTag } from '../lib/guardian.js';
import { useInstallPrompt } from '../hooks/useInstallPrompt.js';
import { prettyTime, prettyClock, prettyDate, localDateStr } from '../lib/format.js';
import { summarise, adherence, STATE_UI } from '../lib/doseState.js';
import { medIcon } from '../lib/medIcon.js';
import { DoseHistory } from '../components/DoseHistory.jsx';
import { useNavigate } from 'react-router-dom';
import { describeSchedule, isDueOn, normaliseTimes } from '../lib/schedule.js';
import { selectMedicines } from '../lib/medicineList.js';
import { describeDoseWithStrength, ROUTES, UNITS, parseAmountInput } from '../lib/doseUnits.js';
import { supplyEstimate, supplyWords } from '../lib/inventory.js';
import { telHref } from '../lib/contacts.js';

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
    if (location.state?.add === 'med') { setBatchOpen(true); window.history.replaceState({}, ''); }
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

  // Today is the page; History and the medicine list open from it and come
  // back with one obvious button, instead of three tabs to learn.
  function go(next) { setView(next); window.scrollTo(0, 0); }

  return (
    <div className="stack">
      {view === 'today' && <TodayView state={today} meds={meds.data || []} actions={actions} windowMinutes={windowMinutes}
        onAdd={() => setBatchOpen(true)}
        onHistory={() => go('calendar')} onManage={() => go('medicines')} />}

      {view === 'calendar' && (
        <div className="stack">
          <SubHead title="History" sub="See how well you've been taking your medicines." onBack={() => go('today')} />
          <AdherenceSummary windowMinutes={windowMinutes} />
          <SegmentedControl className="segmented--accent" label="Show history as" value={historyMode} onChange={setHistoryMode} options={[
            { value: 'list', label: 'List', icon: 'list' },
            { value: 'calendar', label: 'Calendar', icon: 'calendar' },
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
        <div className="stack">
          <SubHead title="Manage medicines" onBack={() => go('today')} />
          <MedicinesView state={meds} onAdd={() => setBatchOpen(true)} onEdit={setEditing}
            onRemove={remove} onDuplicate={(m) => setCopying(m)} onChanged={reloadAll} />
        </div>
      )}

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

// "‹ Medicine" back to the main page, with the sub-page's own heading.
function SubHead({ title, sub, onBack }) {
  return (
    <div className="subhead">
      <button type="button" className="subhead__back" onClick={onBack}>
        <Icon name="back" size={22} /> Medicine
      </button>
      <h2 className="subhead__t">{title}</h2>
      {sub && <p className="subhead__d">{sub}</p>}
    </div>
  );
}

const byTime = (a, b) => String(a.scheduled_time).localeCompare(String(b.scheduled_time));

const longDate = (d) => d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
const atNoon = (iso) => new Date(`${iso}T12:00:00`);
const shiftDay = (iso, n) => { const d = atNoon(iso); d.setDate(d.getDate() + n); return localDateStr(undefined, d); };

const shortDate = (d) => d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
const VIEW_KEY = 'myday_med_view';
function savedView() { try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'calendar'; } catch { return 'calendar'; } }

// The Medicine page. It opens on the month: every day marked taken, missed or
// partly taken, and the day picked on it shown underneath — today is the live
// list with Take buttons; another day swaps in that day's record (or plan),
// with a clear way back to today. "List" is the week-strip view for anyone
// who would rather see one day big. The choice is remembered on the device.
function TodayView({ state, meds, actions, onAdd, onHistory, onManage, windowMinutes }) {
  const today = localDateStr();
  const [mode, setModeState] = useState(savedView);
  const [picked, setPicked] = useState(null);
  function setMode(m) { setModeState(m); try { localStorage.setItem(VIEW_KEY, m); } catch {} }
  // A day picked before midnight should not quietly become "today".
  const day = picked && picked !== today ? picked : today;
  const isToday = day === today;
  const yesterday = shiftDay(today, -1);
  const relative = isToday ? 'Today' : day === yesterday ? 'Yesterday' : day === shiftDay(today, 1) ? 'Tomorrow' : null;
  const title = relative || atNoon(day).toLocaleDateString([], { weekday: 'long' });
  // "Friday" over "Friday, Oct 9" says it twice; under a weekday, just the date.
  const subtitle = relative ? longDate(atNoon(day)) : atNoon(day).toLocaleDateString([], { month: 'long', day: 'numeric' });
  const pick = (d) => setPicked(d === today ? null : d);
  const backToToday = !isToday && (
    <button type="button" className="medhead__back" onClick={() => setPicked(null)}>
      <Icon name="back" size={18} /> Back to today
    </button>
  );
  // In the calendar view the day's heading sits on the list itself, with its
  // "1 of 3 taken" beside it, instead of a ring.
  const dayHeading = { title: relative || atNoon(day).toLocaleDateString([], { weekday: 'long' }), date: shortDate(atNoon(day)), back: backToToday };

  return (
    <div className="stack">
      <p className="page-intro">Take your medicines on time for a healthier you.</p>
      <SegmentedControl className="segmented--accent" label="Show your medicines as" value={mode} onChange={setMode} options={[
        { value: 'calendar', label: 'Calendar', icon: 'calendar' },
        { value: 'list', label: 'List', icon: 'list' },
      ]} />

      {mode === 'calendar' ? (
        <>
          <MedCalendar selected={day} onPick={pick} windowMinutes={windowMinutes} meds={meds} inlineKey />
          <div className="dayview" key={day}>
            {isToday
              ? <TodayList state={state} meds={meds} actions={actions} onAdd={onAdd} windowMinutes={windowMinutes} heading={dayHeading} />
              : <OtherDay day={day} today={today} lateMark={day === yesterday} meds={meds} windowMinutes={windowMinutes} heading={dayHeading} />}
          </div>
        </>
      ) : (
        <>
          <div className="medhead">
            <div className="medhead__text">
              <h2 className="medhead__t" aria-live="polite">{title}</h2>
              <p className="medhead__d">{subtitle}</p>
            </div>
            {/* Beside the title, not under it: a button that comes and goes
                under the date pushed the week strip and every dose up and
                down each time the day changed. */}
            {backToToday}
          </div>
          <DayStrip day={day} today={today} onPick={pick} />
          <div className="dayview" key={day}>
            {isToday
              ? <TodayList state={state} meds={meds} actions={actions} onAdd={onAdd} windowMinutes={windowMinutes} />
              : <OtherDay day={day} today={today} lateMark={day === yesterday} meds={meds} windowMinutes={windowMinutes} />}
          </div>
        </>
      )}

      <button type="button" className="medlink" onClick={onHistory}>
        <span className="medlink__ic" aria-hidden="true"><Icon name="history" size={24} /></span>
        <span className="medlink__t">Your history</span>
        <Icon name="chevron" size={22} />
      </button>
      <button type="button" className="medlink" onClick={onManage}>
        <span className="medlink__ic" aria-hidden="true"><Icon name="gear" size={24} /></span>
        <span className="medlink__t">Manage medicines</span>
        <Icon name="chevron" size={22} />
      </button>
      <RemindersCard />
      <TakeOnTime />
    </div>
  );
}

// "Today · Wed, Oct 7" over the day's doses, with how many were taken.
function DayHeading({ heading, taken, total, planned }) {
  const all = total > 0 && taken === total;
  return (
    <div className="dayhead">
      <div className="dayhead__text">
        <h2 className="dayhead__t" aria-live="polite">{heading.title} <span className="dayhead__d">· {heading.date}</span></h2>
        {heading.back}
      </div>
      {planned != null
        ? <span className="dayhead__pill"><Icon name="calendar" size={18} /> {planned} planned</span>
        : total > 0 && (
          <span className={`dayhead__pill${all ? ' is-done' : ''}`}>
            {all ? <Icon name="check" size={18} stroke={3} /> : null} {taken} of {total} taken
          </span>
        )}
    </div>
  );
}

function TodayList({ state, meds, actions, onAdd, windowMinutes, heading }) {
  const { data: doses, loading, error, reload } = state;
  const asNeeded = meds.filter((m) => m.frequency === 'as_needed');
  if (loading) return <div className="stack"><SkeletonCard lines={2} /><SkeletonCard lines={2} /></div>;
  if (error) return <Card className="center"><p className="lead">Could not load today's doses.</p><Button onClick={reload}>Try again</Button></Card>;
  const scheduled = doses.filter((d) => !d.as_needed);
  const prnLog = doses.filter((d) => d.as_needed);
  if (!scheduled.length && !asNeeded.length) {
    return (
      <HeroEmpty icon="pill" title="No doses scheduled today"
        action={<Button icon="plus" onClick={onAdd}>Add a medicine</Button>}>
        When you add a medicine and its times, today's doses will appear here.
      </HeroEmpty>
    );
  }
  const summary = summarise(scheduled, { windowMinutes });
  // In the order the day happens: each row names its own time, and the
  // button on it can only ever mark that one dose.
  const rows = [...scheduled].sort(byTime);
  return (
    <div className="stack">
      {heading
        ? <DayHeading heading={heading} taken={summary.taken} total={summary.total - summary.skipped} />
        : !!scheduled.length && <DoseRing summary={summary} label="doses taken today" isToday />}
      {heading && summary.missed > 0 && <p className="today__headline is-missed dayhead__note" aria-live="polite">{summary.headline}</p>}
      {!!rows.length && (
        <ul className="drows" aria-label="Today's doses">
          {rows.map((d) => <DoseRow key={d.id} dose={d} actions={actions} windowMinutes={windowMinutes} />)}
        </ul>
      )}
      {!!asNeeded.length && (
        <section className="stack" aria-labelledby="prn-h">
          <h3 className="subsection" id="prn-h">Only when needed</h3>
          <ul className="drows">
            {asNeeded.map((m) => (
              <AsNeededRow key={m.id} med={m} taken={prnLog.filter((d) => d.medication_id === m.id)} actions={actions} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// A day other than today. Past days are the record: when each dose was due,
// when it was taken and whether that was on time. Yesterday can still be
// corrected ("I took it, I just forgot to tap"); older days cannot, so the
// history stays something a doctor or guardian can trust. Later days show
// the plan, labelled as a plan.
function OtherDay({ day, today, lateMark, meds, windowMinutes, heading }) {
  const { data, loading, error, reload } = useAsync(() => (day > today ? Promise.resolve([]) : dosesForDate(day)), [day]);
  const actions = useDoseActions(reload);
  if (day > today) {
    const plan = meds.filter((m) => isDueOn(m, day))
      .flatMap((m) => normaliseTimes(m.times).map((t) => ({ m, t })))
      .sort((a, b) => a.t.localeCompare(b.t));
    if (!plan.length) return <div className="stack">{heading && <DayHeading heading={heading} />}<EmptyState icon="calendar">Nothing is scheduled for this day.</EmptyState></div>;
    return (
      <div className="stack">
        {heading ? <DayHeading heading={heading} planned={plan.length} /> : <DoseRing plan={plan.length} />}
        <ul className="drows" aria-label={`Planned for ${longDate(atNoon(day))}`}>
          {plan.map(({ m, t }) => (
            <li key={`${m.id}-${t}`} className="drow drow--upcoming">
              <div className="drow__row">
                <div className="drow__btn">
                  <span className="drow__ic" style={{ '--med': m.color || '#2563a8' }} aria-hidden="true"><Icon name={medIcon(m)} size={22} /></span>
                  <span className="drow__main">
                    <span className="drow__name" translate="no">{m.name}</span>
                    {m.dose && <span className="drow__dose">{describeDoseWithStrength(m)}</span>}
                    <span className="drow__times">
                      <span className="drow__time"><Icon name="clock" size={17} /> <span><span className="drow__tl">Scheduled</span> {prettyTime(t)}</span></span>
                    </span>
                    <span className="drow__flags"><span className="drow__flag drow__flag--due"><Icon name="calendar" size={14} stroke={2.6} /> Planned</span></span>
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (loading) return <div className="stack"><SkeletonCard lines={2} /><SkeletonCard lines={2} /></div>;
  if (error) return <Card className="center"><p className="lead">Could not load this day.</p><Button onClick={reload}>Try again</Button></Card>;
  if (!data.length) return <div className="stack">{heading && <DayHeading heading={heading} />}<EmptyState icon="calendar">No doses were recorded for this day.</EmptyState></div>;
  const scheduled = data.filter((d) => !d.as_needed);
  const summary = summarise(scheduled, { windowMinutes });
  const byTaken = (a, b) => String(a.scheduled_time || a.taken_at).localeCompare(String(b.scheduled_time || b.taken_at));
  return (
    <div className="stack">
      {heading
        ? <DayHeading heading={heading} taken={summary.taken} total={summary.total - summary.skipped} />
        : !!scheduled.length && <DoseRing summary={summary} label="doses taken" />}
      {lateMark && scheduled.some((d) => d.status !== 'taken' && d.status !== 'skipped') && (
        <p className="dayview__note"><Icon name="info" size={18} /> Took one and forgot to tap? You can still mark yesterday's doses.</p>
      )}
      <ul className="drows" aria-label={`Doses on ${longDate(atNoon(day))}`}>
        {[...data].sort(byTaken).map((d) => (
          <DoseRow key={d.id} dose={d} readOnly lateMark={lateMark} actions={actions} windowMinutes={windowMinutes} />
        ))}
      </ul>
    </div>
  );
}

// This week, Sunday to Saturday. Tapping a day shows it below; the picked day
// is filled in, and today keeps a small dot so it is always easy to find.
function DayStrip({ day, today, onPick }) {
  const start = atNoon(today); start.setDate(start.getDate() - start.getDay());
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  return (
    <div className="daystrip" role="group" aria-label="Pick a day this week">
      {days.map((d) => {
        const iso = localDateStr(undefined, d);
        const label = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
        return (
          <button key={iso} type="button" className={`daystrip__d${iso === day ? ' is-on' : ''}${iso === today ? ' is-today' : ''}`}
            aria-pressed={iso === day} aria-current={iso === today ? 'date' : undefined} onClick={() => onPick(iso)}>
            <span className="daystrip__w" aria-hidden="true">{d.toLocaleDateString([], { weekday: 'short' })}</span>
            <span className="daystrip__n" aria-hidden="true">{d.getDate()}</span>
            <span className="sr-only">{iso === today ? `Today, ${label}` : label}</span>
          </button>
        );
      })}
    </div>
  );
}

// "1 of 3 doses taken today" around a ring that fills as the day goes; for a
// later day, how many doses are planned.
function DoseRing({ summary, label, plan, isToday }) {
  const taken = summary?.taken ?? 0;
  const total = summary?.total ?? plan;
  const pct = summary?.pct ?? 0;
  const r = 34; const c = 2 * Math.PI * r;
  return (
    <div className="ring-card">
      <span className="ring-card__ring" aria-hidden="true">
        <svg viewBox="0 0 84 84" width="84" height="84">
          <circle cx="42" cy="42" r={r} className="ring-card__track" />
          <circle cx="42" cy="42" r={r} className="ring-card__fill" strokeDasharray={c}
            strokeDashoffset={c * (1 - (pct || 0) / 100)} transform="rotate(-90 42 42)" />
        </svg>
        <span className="ring-card__ic"><Icon name="pill" size={26} /></span>
      </span>
      <span className="ring-card__main">
        {summary ? (
          <>
            <span className="ring-card__n">{taken} of {total}</span>
            <span className="ring-card__l">{label}</span>
            <span className={`today__headline${summary.missed ? ' is-missed' : ''}`} aria-live="polite">{isToday ? summary.headline : summary.headline.replace(/ today$/, '')}</span>
          </>
        ) : (
          <>
            <span className="ring-card__n">{total}</span>
            <span className="ring-card__l">{total === 1 ? 'dose planned' : 'doses planned'}</span>
          </>
        )}
      </span>
    </div>
  );
}

// An as-needed medicine is never "due", so it has no reminder and is never
// missed. It can be logged when it is taken, and today's entries are listed
// so a second tap is a visible, deliberate choice.
function AsNeededRow({ med: m, taken, actions }) {
  const [earlier, setEarlier] = useState(false);
  const busy = actions.pending.has(`prn:${m.id}`);
  return (
    <li className="drow drow--prn">
      <div className="drow__row">
        <div className="drow__btn">
          <span className="drow__ic" style={{ '--med': m.color || '#2563a8' }} aria-hidden="true"><Icon name={medIcon(m)} size={22} /></span>
          <span className="drow__main">
            <span className="drow__name" translate="no">{m.name}</span>
            {m.dose && <span className="drow__dose">{describeDoseWithStrength(m)}</span>}
            <span className="drow__time">
              <Icon name="info" size={17} /> <span>{taken.length
                ? `Taken today at ${taken.map((d) => prettyClock(new Date(d.taken_at))).join(', ')}`
                : `${STATE_UI.prn.label} · not taken today`}</span>
            </span>
          </span>
        </div>
        <div className="drow__act">
          <button type="button" className="drow__take drow__take--later" disabled={busy}
            aria-label={`I took one just now: ${m.name}`} onClick={() => actions.takeAsNeeded(m)}>
            <Icon name={busy ? 'clock' : 'pill'} size={20} /> {busy ? 'Saving…' : 'I took one just now'}
          </button>
        </div>
      </div>
      <div className="drow__more drow__more--flat">
        <button type="button" className="dose__skip" onClick={() => setEarlier(true)} disabled={busy}>
          <Icon name="clock" size={18} /> I took one earlier
        </button>
      </div>
      {earlier && (
        <TimePicker title={`When did you take ${m.name}?`} initial={nowHHMM()}
          onCancel={() => setEarlier(false)}
          onPick={(t) => { setEarlier(false); actions.takeAsNeeded(m, timeToday(t)); }} />
      )}
    </li>
  );
}

const nowHHMM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
// Today at HH:MM, never in the future.
function timeToday(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(); d.setHours(h, m, 0, 0);
  return new Date(Math.min(d.getTime(), Date.now())).toISOString();
}

// The dose-reminder switch, right where the doses are. It is the same
// setting as "Dose reminders" in Profile → Alerts & reminders, and it says so
// when this device cannot actually show a reminder yet.
function RemindersCard() {
  const ui = useUI();
  const navigate = useNavigate();
  const { installed } = useInstallPrompt();
  const [prefs, setPrefs] = useState(null);
  useEffect(() => { getNotificationPrefs().then(setPrefs).catch(() => setPrefs(false)); }, []);
  if (prefs === false) return null;
  const on = !!prefs && prefs.master !== false && prefs.dose_due !== false;
  const status = deliveryStatus({
    supported: pushSupported(),
    permission: typeof Notification !== 'undefined' ? Notification.permission : 'default',
    installed, platform: platformTag(),
  });
  async function set(v) {
    const patch = v ? { dose_due: true, ...(prefs.master === false ? { master: true } : {}) } : { dose_due: false };
    const before = prefs;
    setPrefs({ ...prefs, ...patch });
    try { await saveNotificationPrefs(patch); ui.toast(v ? 'Dose reminders are on.' : 'Dose reminders are off.', 'info'); }
    catch { setPrefs(before); ui.toast('Could not save that setting.', 'bad'); }
  }
  return (
    <Card className="remind-card">
      <div className="remind-card__row">
        <span className="remind-card__ic" aria-hidden="true"><Icon name="bell" size={22} /></span>
        <div className="remind-card__main">
          <div className="remind-card__t" id="remind-t">Reminders</div>
          <div className="remind-card__d" id="remind-d">Get a friendly reminder when it's time to take your medicine.</div>
        </div>
        <Toggle checked={on} disabled={!prefs} onChange={set} labelledBy="remind-t" describedBy="remind-d" />
      </div>
      {on && !status.ok && (
        <button type="button" className="remind-card__fix" onClick={() => navigate('/profile', { state: { open: 'alerts' } })}>
          <Icon name="alert" size={18} /> <span>{status.code === 'not_asked' ? 'Turn on alerts for this device' : 'Reminders cannot reach this device yet'}</span>
          <Icon name="chevron" size={18} />
        </button>
      )}
    </Card>
  );
}

// A friendly closing note with a little picture: the bottle and a glass of water.
function TakeOnTime() {
  return (
    <div className="ontime">
      <div className="ontime__text">
        <h3 className="ontime__t">Take your medicine on time</h3>
        <p className="ontime__d">Staying on track helps you feel better.</p>
      </div>
      <svg className="ontime__art" viewBox="0 0 150 120" aria-hidden="true">
        <ellipse cx="80" cy="112" rx="66" ry="6" className="ontime__shadow" />
        <circle cx="34" cy="68" r="22" className="ontime__cloud" />
        <circle cx="120" cy="58" r="26" className="ontime__cloud" />
        <rect x="46" y="22" width="44" height="14" rx="4" className="ontime__cap" />
        <rect x="40" y="34" width="56" height="78" rx="10" className="ontime__bottle" />
        <rect x="48" y="54" width="40" height="36" rx="6" className="ontime__label" />
        <path d="M68 82s-11-6.5-11-14a6 6 0 0111-3.2A6 6 0 0179 68c0 7.5-11 14-11 14z" className="ontime__heart" />
        <path d="M100 58h34l-4 52a4 4 0 01-4 3.6h-18a4 4 0 01-4-3.6z" className="ontime__glass" />
        <path d="M102.5 76h29l-2.6 33.6a3 3 0 01-3 2.4h-17.8a3 3 0 01-3-2.4z" className="ontime__water" />
        <circle cx="128" cy="26" r="13" className="ontime__bubble" />
        <path d="M128 32s-6-3.6-6-7.6a3.2 3.2 0 016-1.7 3.2 3.2 0 016 1.7c0 4-6 7.6-6 7.6z" className="ontime__heart" />
      </svg>
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
      <details className="adh__how">
        <summary><Icon name="info" size={22} /> <span>How is this worked out?</span> <Icon name="chevron" size={20} className="adh__chev" /></summary>
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
    <ul className="drows">
      {[...data].sort(byTime).map((d) => <DoseRow key={d.id} dose={d} readOnly windowMinutes={windowMinutes} />)}
    </ul>
  );
}

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
          Type each medicine, check the list, then save them together.
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
  const ui = useUI();
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
          {/* The per-medicine switch left Settings; turning a silenced medicine
              back on lives here, next to the medicine itself. */}
          {!m.reminders_enabled && !asNeeded && (
            <div className="medrow__off">
              <span><Icon name="bell" size={16} /> Reminders are off for this medicine</span>
              <Button size="sm" full={false} icon="bell" onClick={async () => {
                try { await setMedicationReminders(m.id, { enabled: true }); ui.toast(`Reminders on for ${m.name}.`); onChanged?.(); }
                catch { ui.toast('Could not save.', 'bad'); }
              }}>Turn reminders on</Button>
            </div>
          )}
          {(pharmacy || prescriber) && (
            <div className="medrow__contacts">
              {[['Pharmacy', pharmacy], ['Prescriber', prescriber]].filter(([, c]) => c).map(([role, c]) => (
                telHref(c.phone)
                  ? <a key={role} className="btn btn--ghost btn--sm" href={telHref(c.phone)}
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
