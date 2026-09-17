import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon.jsx';
import { InstallCard } from '../components/InstallCard.jsx';
import { MedCalendar } from '../components/MedCalendar.jsx';
import { SegmentedControl, Skeleton, SkeletonCard, Pill, Modal } from '../components/ui.jsx';
import {
  getGuardianToken, linkWithCode, fetchDashboard, disconnectThisDevice,
  enableGuardianPush, disableGuardianPush, setDailySummary, GuardianUnlinked,
} from '../lib/guardian.js';
import { pushSupported, enablePush, isInstalled } from '../lib/push.js';
import { doseState, summarise, sortForDisplay, adherence, dayMarkFromCounts, STATE_UI } from '../lib/doseState.js';
import { prettyTime, prettyClock, prettyDate, shortDate } from '../lib/format.js';

// The guardian side of MyDay: a persistent, READ-ONLY dashboard for the person
// looking after someone. No account, no sign-in — the device itself is the
// credential (see src/lib/guardian.js) and every read goes through the
// `guardian-data` edge function.
//
// Before this existed, a guardian typed a 6-digit code, was told alerts were on
// and then had nowhere to go, which made it feel as though the site had
// vanished and nothing had been saved. This is the page that was missing.

const SEEN_INTRO_KEY = 'myday_guardian_intro_seen';
const POLL_MS = 60_000;

// A manifest has exactly one start_url, and the senior's app starts at '/'.
// So the guardian page points at its own manifest while it is on screen: a
// guardian who installs from here gets an icon that opens straight onto
// /guardian, rather than landing on a sign-in screen they can never pass.
function useGuardianManifest() {
  useEffect(() => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return;
    const original = link.getAttribute('href');
    link.setAttribute('href', '/manifest-guardian.webmanifest');
    // The theme colour is shared, so only the manifest needs restoring.
    return () => { if (original) link.setAttribute('href', original); };
  }, []);
}

export default function Guardian() {
  useGuardianManifest();
  // Anyone arriving from an old invite link still lands on code entry; the link
  // route is handled by the existing guardian-join function and is unchanged.
  const [linked, setLinked] = useState(() => !!getGuardianToken());
  if (!linked) return <LinkDevice onLinked={() => setLinked(true)} />;
  return <Dashboard onUnlinked={() => setLinked(false)} />;
}

/* ============================== code entry ============================== */

function LinkDevice({ onLinked }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(code) {
    setError('');
    setBusy(true);
    try {
      await linkWithCode(code, name.trim());
      onLinked();
    } catch (e) {
      setError(e.message || 'Could not connect. Please try again.');
      setBusy(false);
    }
  }

  return (
    <div className="mkt ob">
      <div className="ob__top">
        <a className="mkt-btn mkt-btn--link" href="/"><Icon name="back" size={20} /> Back</a>
        <div className="mkt-brand" style={{ fontSize: 20 }}>
          <span className="mkt-brand__mark" style={{ width: 30, height: 30 }}><Icon name="pulse" size={16} /></span>MyDay
        </div>
        <span style={{ width: 70 }} />
      </div>
      <div className="ob__body">
        <div className="ob__card">
          <h2 className="ob__q" style={{ marginBottom: 6 }}>Enter your code</h2>
          <p style={{ color: 'var(--m-soft)', marginTop: 0, marginBottom: 18 }}>
            Ask the person you're helping to open MyDay, tap <b>Profile</b>, then <b>Invite a guardian</b>.
            They'll read you a 6-digit code. It lasts 15 minutes.
          </p>
          {error && <div className="ob__err" role="alert">{error}</div>}

          <div className="ob-field">
            <label htmlFor="g-name">Your name</label>
            <input id="g-name" className="ob-input" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sarah" autoComplete="name" />
          </div>

          <CodeEntry error={error} busy={busy} onSubmit={submit} />
        </div>
      </div>
    </div>
  );
}

// Six big digit boxes. One digit per box, auto-advance, paste and backspace all
// work, and the numeric keypad comes up on a tablet.
function CodeEntry({ error, busy, onSubmit }) {
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const refs = useRef([]);
  const code = digits.join('');

  useEffect(() => { refs.current[0]?.focus(); }, []);
  // A rejected code clears itself: retyping is one action rather than six
  // backspaces, and the empty boxes are themselves the "try again" signal.
  useEffect(() => {
    if (!error) return;
    setDigits(['', '', '', '', '', '']);
    refs.current[0]?.focus();
  }, [error]);

  function setAt(i, value) {
    const only = value.replace(/\D/g, '');
    if (!only) { setDigits((d) => d.map((x, j) => (j === i ? '' : x))); return; }
    // A paste (or a fast typist) can deliver several digits at once.
    setDigits((d) => {
      const next = [...d];
      for (let k = 0; k < only.length && i + k < 6; k++) next[i + k] = only[k];
      return next;
    });
    refs.current[Math.min(i + only.length, 5)]?.focus();
  }
  function onKeyDown(i, e) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      e.preventDefault();
      setDigits((d) => d.map((x, j) => (j === i - 1 ? '' : x)));
      refs.current[i - 1]?.focus();
    }
    if (e.key === 'Enter' && code.length === 6) onSubmit(code);
  }

  return (
    <>
      <div className={`code-boxes${error ? ' code-boxes--rejected' : ''}`}>
        {digits.map((d, i) => (
          <input key={i} ref={(el) => { refs.current[i] = el; }} className="code-box"
            type="text" inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'}
            maxLength={6} value={d} aria-label={`Digit ${i + 1} of 6`}
            onChange={(e) => setAt(i, e.target.value)} onKeyDown={(e) => onKeyDown(i, e)}
            onFocus={(e) => e.target.select()} />
        ))}
      </div>
      <div className="ob__actions">
        <button type="button" className="mkt-btn mkt-btn--primary mkt-btn--block"
          disabled={code.length !== 6 || busy} onClick={() => onSubmit(code)}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </div>
    </>
  );
}

/* =============================== dashboard =============================== */

function Dashboard({ onUnlinked }) {
  const [state, setState] = useState({ loading: true, data: null, cached: false, at: null, error: '' });
  const [view, setView] = useState('today');
  const [refreshing, setRefreshing] = useState(false);
  // 'spin' while a refresh runs, 'done' for the settle-into-✓ beat afterwards.
  const [refreshPhase, setRefreshPhase] = useState('idle');
  const [intro, setIntro] = useState(() => {
    try { return !localStorage.getItem(SEEN_INTRO_KEY); } catch { return false; }
  });

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setRefreshing(true);
    setRefreshPhase('spin');
    try {
      const res = await fetchDashboard();
      setState({ loading: false, data: res.data, cached: res.cached, at: res.at, error: '' });
      setRefreshPhase('done');
      setTimeout(() => setRefreshPhase('idle'), 900);
    } catch (e) {
      setRefreshPhase('idle');
      if (e instanceof GuardianUnlinked) { onUnlinked(); return; }
      setState((s) => ({ ...s, loading: false, error: e.message || 'Could not refresh.' }));
    } finally {
      setRefreshing(false);
    }
  }, [onUnlinked]);

  useEffect(() => { load({ quiet: true }); }, [load]);

  // Auto refresh only while the page is actually being looked at: polling a
  // backgrounded tab drains a guardian's battery for nothing.
  useEffect(() => {
    let timer = null;
    const tick = () => { if (document.visibilityState === 'visible') load({ quiet: true }); };
    const start = () => { stop(); timer = setInterval(tick, POLL_MS); };
    const stop = () => { if (timer) clearInterval(timer); timer = null; };
    const onVis = () => {
      if (document.visibilityState === 'visible') { tick(); start(); } else stop();
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVis);
    return () => { stop(); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  const pull = usePullToRefresh(() => load());

  if (state.loading) return <GuardianSkeleton />;

  if (!state.data) {
    return (
      <GuardianFrame onRefresh={() => load()} refreshing={refreshing} phase={refreshPhase}>
        <div className="card center">
          <p className="lead">{state.error || 'We could not load the dashboard.'}</p>
          <button className="btn btn--primary btn--md btn--full" onClick={() => load()}>Try again</button>
        </div>
      </GuardianFrame>
    );
  }

  const d = state.data;
  const windowMinutes = d.patient?.alert_window_minutes ?? 60;
  const opts = { windowMinutes };
  const todaySummary = summarise(d.today?.doses || [], opts);

  return (
    <GuardianFrame onRefresh={() => load()} refreshing={refreshing} phase={refreshPhase} pull={pull}>
      {intro && <IntroSheet permissions={d.permissions} patient={d.patient?.name}
        onClose={() => { setIntro(false); try { localStorage.setItem(SEEN_INTRO_KEY, '1'); } catch {} }} />}

      <StatusHeader patient={d.patient} summary={todaySummary} date={d.today?.date} />

      {state.cached && <StaleBanner at={state.at} />}
      {state.error && !state.cached && <div className="g-warn" role="status">{state.error}</div>}

      <SegmentedControl value={view} onChange={setView} options={[
        { value: 'today', label: 'Today' },
        { value: 'visits', label: 'Visits' },
        { value: 'history', label: 'History' },
      ]} />

      {view === 'today' && <TodayPanel doses={d.today?.doses || []} opts={opts} summary={todaySummary} />}
      {view === 'visits' && <VisitsPanel appointments={d.appointments || []} />}
      {view === 'history' && <HistoryPanel history={d.history || []} opts={opts} />}

      {!!d.diary?.length && <DiaryPanel entries={d.diary} />}

      <CallPanel patient={d.patient?.name} contacts={d.contacts || []} />

      <AlertsPanel notifications={d.notifications} patient={d.patient?.name} onChanged={() => load({ quiet: true })} />

      <ReadOnlyNote permissions={d.permissions} onShowIntro={() => setIntro(true)} />

      <DisconnectPanel onDone={onUnlinked} />
    </GuardianFrame>
  );
}

// Shell: brand bar with a refresh control that spins, then settles into a ✓.
function GuardianFrame({ children, onRefresh, refreshing, phase, pull }) {
  return (
    <div className="g-shell" {...(pull?.handlers || {})}>
      <header className="g-top">
        <div className="mkt-brand" style={{ fontSize: 19 }}>
          <span className="mkt-brand__mark" style={{ width: 28, height: 28 }}><Icon name="pulse" size={15} /></span>MyDay
        </div>
        <button className="g-refresh" onClick={onRefresh} disabled={refreshing}
          aria-label="Refresh" data-phase={phase}>
          <Icon name={phase === 'done' ? 'check' : 'refresh'} size={21} />
        </button>
      </header>
      {pull?.indicator}
      <main className="g-content">{children}</main>
    </div>
  );
}

function StatusHeader({ patient, summary, date }) {
  // One word for the whole day, so a guardian glancing at a phone on the bus
  // gets the answer before reading anything else.
  const tone = summary.missed ? 'bad' : summary.overdue ? 'warn' : summary.allTaken ? 'good' : 'neutral';
  return (
    <section className={`g-status g-status--${tone}`} aria-label="Today's overall state">
      <div className="g-status__who">
        <span className="g-status__eyebrow">Caring for</span>
        <h1 className="g-status__name">{patient?.name}</h1>
        <p className="g-status__date">{prettyDate(date)}</p>
      </div>
      <p className="g-status__headline" aria-live="polite">
        <span className="g-status__ic"><Icon name={summary.missed || summary.overdue ? 'bell' : 'check'} size={22} /></span>
        {summary.headline}
      </p>
      {summary.total > 0 && (
        <div className="g-status__counts">
          <Count n={summary.taken} label="Taken" kind="taken" />
          <Count n={summary.missed} label="Missed" kind="missed" />
          <Count n={summary.toTake} label="To take" kind="pending" />
        </div>
      )}
    </section>
  );
}
function Count({ n, label, kind }) {
  return (
    <div className={`g-count g-count--${kind}`}>
      <div className="g-count__n">{n}</div>
      <div className="g-count__l">{label}</div>
    </div>
  );
}

function StaleBanner({ at }) {
  return (
    <div className="g-stale" role="status">
      <Icon name="clock" size={20} />
      <span>
        No connection — showing what was saved. Last updated{' '}
        {at ? prettyClock(new Date(at)) : 'earlier'}
        {at && !isToday(at) ? ` on ${shortDate(new Date(at).toISOString().slice(0, 10))}` : ''}.
      </span>
    </div>
  );
}
function isToday(ms) {
  const a = new Date(ms); const b = new Date();
  return a.toDateString() === b.toDateString();
}

/* ------------------------------- today -------------------------------- */

function TodayPanel({ doses, opts, summary }) {
  if (!doses.length) {
    return (
      <div className="card hero-empty">
        <div className="hero-empty__art"><Icon name="pill" size={52} stroke={1.8} /></div>
        <h3 className="hero-empty__title">No medicines scheduled today</h3>
        <p className="hero-empty__text">There is nothing to check on today.</p>
      </div>
    );
  }
  const ordered = sortForDisplay(doses, opts);
  return (
    <div className="stack">
      {summary.total > 1 && (
        <div className="g-bar" aria-hidden="true">
          <div className="g-bar__fill" style={{ width: `${summary.pct}%` }} />
        </div>
      )}
      <ul className="g-list" aria-label="Today's medications">
        {ordered.map((dose, i) => (
          <li key={dose.id} className="g-reveal" style={{ '--i': i }}>
            <DoseRow dose={dose} opts={opts} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function DoseRow({ dose, opts }) {
  const st = doseState(dose, opts);
  const ui = STATE_UI[st];
  const m = dose.medication || {};
  return (
    <div className={`g-dose g-dose--${ui.tone}`}>
      <span className="g-dose__chip" style={{ background: m.color || 'var(--primary)' }} aria-hidden="true">
        <Icon name="pill" size={18} />
      </span>
      <div className="g-dose__main">
        <div className="g-dose__name">{m.name || 'Medicine'}</div>
        <div className="g-dose__meta">
          {m.dose ? <span>{m.dose}</span> : null}
          <span>Scheduled {prettyTime(dose.scheduled_time)}</span>
        </div>
        {/* The exact time it was marked is the thing a guardian actually wants. */}
        {st === 'taken' && dose.taken_at && (
          <div className="g-dose__when">Marked taken at {prettyClock(new Date(dose.taken_at))}</div>
        )}
        {m.note && <div className="g-dose__note">{m.note}</div>}
      </div>
      {/* Colour, icon and word together — never colour alone. */}
      <span className={`g-badge g-badge--${ui.tone}`}>
        <Icon name={ui.icon} size={16} /> {ui.label}
      </span>
    </div>
  );
}

/* ------------------------------- visits ------------------------------- */

function VisitsPanel({ appointments }) {
  if (!appointments.length) {
    return (
      <div className="card hero-empty">
        <div className="hero-empty__art"><Icon name="calendar" size={52} stroke={1.8} /></div>
        <h3 className="hero-empty__title">No upcoming appointments</h3>
        <p className="hero-empty__text">Appointments added in MyDay will show here.</p>
      </div>
    );
  }
  return (
    <ul className="g-list" aria-label="Upcoming appointments">
      {appointments.map((a, i) => (
        <li key={a.id} className="g-reveal" style={{ '--i': i }}>
          <div className="g-appt">
            <div className="g-appt__date">
              <span className="g-appt__d">{new Date(`${a.appt_date}T00:00:00`).getDate()}</span>
              <span className="g-appt__m">
                {new Date(`${a.appt_date}T00:00:00`).toLocaleDateString([], { month: 'short' })}
              </span>
            </div>
            <div className="g-appt__main">
              <div className="g-dose__name">{a.doctor_name || a.reason || 'Appointment'}</div>
              <div className="g-dose__meta">
                <span>{prettyDate(a.appt_date)}</span>
                {a.appt_time && <span>{prettyTime(a.appt_time)}</span>}
              </div>
              {a.location && <div className="g-dose__note"><Icon name="pin" size={15} /> {a.location}</div>}
              {a.reason && a.doctor_name && <div className="g-dose__note">{a.reason}</div>}
            </div>
            <Pill kind="pending">{countdown(a.appt_date)}</Pill>
          </div>
        </li>
      ))}
    </ul>
  );
}

function countdown(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const then = new Date(y, m - 1, d);
  const now = new Date();
  const days = Math.round((then - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 7) return `In ${days} days`;
  if (days < 14) return 'Next week';
  return `In ${Math.round(days / 7)} weeks`;
}

/* ------------------------------- history ------------------------------- */

// How many days of the grouped list to render before "Show more". Rendering
// all 60 days at once produced a page tens of thousands of pixels tall, which
// is unusable on a phone and slow to lay out.
const HISTORY_PAGE = 7;

function HistoryPanel({ history, opts }) {
  const [day, setDay] = useState(null);
  const [limit, setLimit] = useState(HISTORY_PAGE);

  // Per-day aggregates for the calendar, in exactly the shape MedCalendar
  // wants, so the guardian's marks match the senior's own calendar.
  const counts = useMemo(() => {
    const map = {};
    for (const dose of history) {
      const e = (map[dose.dose_date] ||= { taken: 0, missed: 0, pending: 0, total: 0 });
      const st = doseState(dose, opts);
      if (st === 'taken') e.taken++;
      else if (st === 'missed') e.missed++;
      else e.pending++;
      e.total++;
    }
    return map;
  }, [history, opts]);

  const byDay = useMemo(() => {
    const map = new Map();
    for (const dose of history) {
      if (!map.has(dose.dose_date)) map.set(dose.dose_date, []);
      map.get(dose.dose_date).push(dose);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [history]);

  const last7 = useMemo(() => {
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    return adherence(history.filter((h) => h.dose_date >= cutoff), opts);
  }, [history, opts]);

  // Picking a day narrows to that day; otherwise show a page at a time.
  const matching = day ? byDay.filter(([date]) => date === day) : byDay;
  const shown = day ? matching : matching.slice(0, limit);
  const more = matching.length - shown.length;

  return (
    <div className="stack">
      {last7.pct != null && (
        <div className="g-adherence">
          <div className="g-adherence__pct">{last7.pct}%</div>
          <div>
            <div className="g-adherence__t">Last 7 days</div>
            <div className="g-adherence__d">Took {last7.taken} of {last7.total} doses</div>
          </div>
        </div>
      )}

      <MedCalendar counts={counts} selected={day}
        onPick={(pick) => { setDay((cur) => (cur === pick ? null : pick)); setLimit(HISTORY_PAGE); }} />

      {day && (
        <button className="g-clear" onClick={() => setDay(null)}>
          <Icon name="close" size={18} /> Showing {prettyDate(day)} — show all days
        </button>
      )}

      {!shown.length ? (
        <div className="card center"><p className="lead">No doses recorded for this day.</p></div>
      ) : (
        <div className="stack">
          {shown.map(([date, doses]) => {
            const s = summarise(doses, opts);
            const mark = dayMarkFromCounts({ taken: s.taken, missed: s.missed, pending: s.toTake });
            return (
              <section key={date} className="g-day">
                <header className="g-day__head">
                  <h3 className="g-day__title">{prettyDate(date)}</h3>
                  <span className={`g-badge g-badge--${mark === 'taken' ? 'taken' : mark === 'missed' ? 'missed' : mark === 'partial' ? 'overdue' : 'upcoming'}`}>
                    {s.taken}/{s.total} taken
                  </span>
                </header>
                <ul className="g-list">
                  {sortForDisplay(doses, opts).map((dose) => (
                    <li key={dose.id}><DoseRow dose={dose} opts={opts} /></li>
                  ))}
                </ul>
              </section>
            );
          })}
          {more > 0 && (
            <button className="g-more" onClick={() => setLimit((n) => n + HISTORY_PAGE * 2)}>
              <Icon name="chevron" size={20} />
              Show {Math.min(more, HISTORY_PAGE * 2)} more day{Math.min(more, HISTORY_PAGE * 2) === 1 ? '' : 's'}
              <span className="g-more__rest">{more} still hidden</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------- diary -------------------------------- */

function DiaryPanel({ entries }) {
  return (
    <section className="card">
      <h3 className="g-section">Recent health notes</h3>
      <ul className="g-list">
        {entries.map((e) => (
          <li key={e.id} className="g-note">
            <div className="g-dose__name">{e.title || e.category}</div>
            {e.body && <p className="g-note__body">{e.body}</p>}
            <div className="g-dose__meta"><span>{prettyClock(new Date(e.entry_at))}</span>
              <span>{shortDate(e.entry_at.slice(0, 10))}</span></div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* -------------------------------- calling ------------------------------- */

function CallPanel({ patient, contacts }) {
  // Whoever is most useful in an emergency first: the person themselves, then
  // their doctor or pharmacy.
  const ordered = [...contacts].sort((a, b) => rankContact(a) - rankContact(b));
  if (!ordered.length) return null;
  return (
    <section className="card">
      <h3 className="g-section">Call for help</h3>
      <div className="g-calls">
        {ordered.slice(0, 4).map((c) => (
          <a key={c.id} className="g-call" href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>
            <span className="g-call__ic"><Icon name="phone" size={20} /></span>
            <span className="g-call__main">
              <span className="g-call__name">{c.name}</span>
              <span className="g-call__type">{contactWord(c.type)}</span>
            </span>
          </a>
        ))}
      </div>
      <p className="muted" style={{ margin: '10px 0 0', fontSize: 15 }}>
        These are the numbers {patient} saved in MyDay.
      </p>
    </section>
  );
}
const CONTACT_RANK = { provider: 0, clinic: 1, pharmacy: 2, insurance: 3, merchant: 5, other: 4 };
const rankContact = (c) => CONTACT_RANK[c.type] ?? 9;
const CONTACT_WORD = {
  provider: 'Doctor', clinic: 'Clinic', pharmacy: 'Pharmacy',
  insurance: 'Insurance', merchant: 'Shop', other: 'Contact',
};
const contactWord = (t) => CONTACT_WORD[t] || 'Contact';

/* ------------------------------- alerts -------------------------------- */

function AlertsPanel({ notifications, patient, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const on = !!notifications?.push_enabled;
  const summaryAt = notifications?.daily_summary_at || '';
  const installed = isInstalled();

  async function turnOn() {
    setError(''); setBusy(true);
    try {
      const sub = await enablePush();
      await enableGuardianPush(sub);
      onChanged();
    } catch (e) { setError(e.message || 'Could not turn on alerts.'); }
    finally { setBusy(false); }
  }
  async function turnOff() {
    setBusy(true);
    try { await disableGuardianPush(); onChanged(); }
    catch (e) { setError(e.message || 'Could not turn off alerts.'); }
    finally { setBusy(false); }
  }
  async function pickSummary(value) {
    setBusy(true);
    try { await setDailySummary(value || null); onChanged(); }
    catch (e) { setError(e.message || 'Could not save.'); }
    finally { setBusy(false); }
  }

  return (
    <section className="card">
      <h3 className="g-section">Alerts on this device</h3>
      {error && <div className="g-warn" role="alert">{error}</div>}

      {!pushSupported() ? (
        <p className="muted" style={{ margin: 0 }}>
          This browser cannot show alerts. On an iPhone or iPad, add MyDay to your home screen
          using Safari, then open it from there.
        </p>
      ) : on ? (
        <>
          <p className="g-ok"><Icon name="check" size={20} /> You'll be alerted if {patient} misses a medicine.</p>
          <label className="g-field">
            <span>Daily summary</span>
            <select className="input" value={summaryAt} disabled={busy}
              onChange={(e) => pickSummary(e.target.value)}>
              <option value="">Don't send one</option>
              <option value="09:00">Every morning at 9:00</option>
              <option value="13:00">Every afternoon at 1:00</option>
              <option value="19:00">Every evening at 7:00</option>
              <option value="21:00">Every night at 9:00</option>
            </select>
          </label>
          <button className="btn btn--ghost btn--sm btn--full" disabled={busy} onClick={turnOff}>
            Turn off alerts on this device
          </button>
        </>
      ) : (
        <>
          {/* Installing is not optional dressing: iPadOS will not deliver web
              push at all until the app is on the home screen. */}
          {!installed && (
            <InstallCard why={`Alerts only arrive properly — and show as MyDay rather than your browser — once MyDay is on your home screen. On an iPad they will not arrive at all until then.`} />
          )}
          <div style={{ height: 10 }} />
          <button className="btn btn--primary btn--md btn--full" disabled={busy} onClick={turnOn}>
            <Icon name="bell" size={20} /><span>{busy ? 'Turning on…' : 'Turn on alerts'}</span>
          </button>
        </>
      )}
    </section>
  );
}

/* ---------------------------- what I can see ---------------------------- */

function IntroSheet({ permissions, patient, onClose }) {
  return (
    <Modal title="What you can see" onClose={onClose}>
      <p className="dialog-msg">
        This page shows you how {patient} is doing with their medicines. It stays on this device,
        so you can come back any time without a code.
      </p>
      <ul className="g-can">
        <li className="g-can__yes"><Icon name="check" size={20} /> Today's medicines and whether each was taken</li>
        <li className="g-can__yes"><Icon name="check" size={20} /> Their upcoming appointments</li>
        <li className="g-can__yes"><Icon name="check" size={20} /> A history of taken and missed doses</li>
        {permissions?.can_read?.includes('diary') && (
          <li className="g-can__yes"><Icon name="check" size={20} /> Their recent health notes</li>
        )}
        <li className="g-can__no"><Icon name="close" size={20} /> You cannot change anything — not medicines, not appointments</li>
        <li className="g-can__no"><Icon name="close" size={20} /> You cannot mark a dose as taken. Only {patient} can do that</li>
        <li className="g-can__no"><Icon name="close" size={20} /> You cannot see anything else in their MyDay account</li>
      </ul>
      <p className="dialog-msg">
        {patient} can disconnect you at any time from their Profile.
      </p>
      <button className="btn btn--primary btn--md btn--full" onClick={onClose}>I understand</button>
    </Modal>
  );
}

function ReadOnlyNote({ permissions, onShowIntro }) {
  return (
    <button type="button" className="g-readonly" onClick={onShowIntro}>
      <Icon name="eye" size={20} />
      <span>
        <b>You are viewing only.</b> {permissions?.read_only === false
          ? ''
          : 'Nothing you do here can change their information.'} Tap to see what you can and cannot see.
      </span>
      <Icon name="chevron" size={20} />
    </button>
  );
}

/* ----------------------------- disconnecting ---------------------------- */

function DisconnectPanel({ onDone }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    try { await disconnectThisDevice(); }
    finally { setBusy(false); onDone(); }
  }

  return (
    <>
      <button type="button" className="g-disconnect" onClick={() => setAsking(true)}>
        <Icon name="unlink" size={20} /> This is not my device — disconnect
      </button>
      {asking && (
        <Modal title="Disconnect this device?" onClose={() => setAsking(false)}>
          <p className="dialog-msg">
            This device will stop showing the dashboard and stop receiving alerts. You will need a new
            6-digit code to connect again.
          </p>
          <div className="btn-row" style={{ marginTop: 18 }}>
            <button className="btn btn--ghost btn--md btn--full" onClick={() => setAsking(false)}>Keep it connected</button>
            <button className="btn btn--danger-solid btn--md btn--full" disabled={busy} onClick={go}>
              {busy ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ------------------------------- plumbing ------------------------------- */

// Pull-to-refresh. Only arms at the very top of the page so it can never
// fight a normal scroll, and only for touch — a mouse has the button.
function usePullToRefresh(onRefresh) {
  const [pull, setPull] = useState(0);
  const start = useRef(null);
  const THRESHOLD = 70;

  const handlers = {
    onTouchStart: (e) => {
      if (window.scrollY > 0 || e.touches.length !== 1) { start.current = null; return; }
      start.current = e.touches[0].clientY;
    },
    onTouchMove: (e) => {
      if (start.current == null) return;
      const dy = e.touches[0].clientY - start.current;
      if (dy > 0) setPull(Math.min(dy * 0.5, THRESHOLD + 20));
    },
    onTouchEnd: () => {
      if (pull >= THRESHOLD) onRefresh();
      start.current = null;
      setPull(0);
    },
    onTouchCancel: () => { start.current = null; setPull(0); },
  };

  const indicator = pull > 0 ? (
    <div className="g-pull" style={{ height: pull }} aria-hidden="true">
      <Icon name="refresh" size={20} />
      <span>{pull >= THRESHOLD ? 'Release to refresh' : 'Pull to refresh'}</span>
    </div>
  ) : null;

  return { handlers, indicator };
}

function GuardianSkeleton() {
  return (
    <div className="g-shell">
      <header className="g-top">
        <div className="mkt-brand" style={{ fontSize: 19 }}>
          <span className="mkt-brand__mark" style={{ width: 28, height: 28 }}><Icon name="pulse" size={15} /></span>MyDay
        </div>
      </header>
      <main className="g-content" role="status" aria-label="Loading the dashboard">
        <Skeleton h={150} r={20} />
        <div style={{ height: 14 }} />
        <Skeleton h={56} r={16} />
        <div style={{ height: 14 }} />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
        <span className="sr-only">Loading…</span>
      </main>
    </div>
  );
}
