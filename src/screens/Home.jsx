import { useEffect, useState } from 'react';
import { useDoseActions } from '../hooks/useDoseActions.js';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { useDayRefresh } from '../hooks/useDayRefresh.js';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Button, Avatar, Skeleton, SkeletonCard, Modal, Toggle } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { MedCalendar, WeekStrip } from '../components/MedCalendar.jsx';
import { DoseRow } from '../components/DoseRow.jsx';
import { getNotificationPrefs, todaysDoses, upcomingAppointments, pastAppointments, playedTodayCount, listGuardians, listMedications, listContacts, listDiary, saveDiary, deleteDiary } from '../lib/db.js';
import { prettyTime, prettyDate, localDateStr } from '../lib/format.js';
import { telHref } from '../lib/contacts.js';
import { countdownLabel } from '../lib/appointments.js';
import { MOODS, normalizeLayout, moveWidget, toggleWidget, todaysMood, widgetInfo, DEFAULT_LAYOUT } from '../lib/homeWidgets.js';
import { profileCompleteness } from '../lib/appearance.js';
import { summarise, sortForDisplay, doseState, STATE_UI } from '../lib/doseState.js';
import { deliveryStatus } from '../lib/notifications.js';
import { pushSupported } from '../lib/push.js';
import { platformTag } from '../lib/guardian.js';
import { listAccountGuardians } from '../lib/guardianAccount.js';
import { playAlarmOnce } from '../lib/alarm.js';
import { useInstallPrompt } from '../hooks/useInstallPrompt.js';

export default function Home() {
  const { profile } = useApp();
  const ui = useUI();
  const { installed } = useInstallPrompt();
  const navigate = useNavigate();
  const [fullMonth, setFullMonth] = useState(false);
  const [layout, setLayout] = useHomeLayout();
  const [editing, setEditing] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const reminderProblem = useReminderProblem(installed);
  const { data, loading, error, reload } = useAsync(async () => {
    // Guardians are a nudge, not the day: if they fail to load, show nothing.
    const [doses, appts, games, guardians, watching, meds, contacts, diary, past] = await Promise.all([
      todaysDoses(), upcomingAppointments(), playedTodayCount(), listGuardians().catch(() => null),
      listAccountGuardians().catch(() => []), listMedications().catch(() => []), listContacts().catch(() => null),
      listDiary(20).catch(() => []), pastAppointments(3).catch(() => []),
    ]);
    return { doses, appts, games, guardians, watching, meds, contacts, diary, past };
  });
  useDayRefresh(reload);
  const actions = useDoseActions(reload);
  // Opening MyDay with a dose that has just been missed sounds the loud alarm
  // for it, once. Doses missed on earlier days do not.
  useEffect(() => {
    if (!data?.doses) return;
    const windowMinutes = profile?.alert_window_minutes ?? 60;
    const fresh = data.doses.find((d) => doseState(d, { windowMinutes }) === 'missed');
    if (fresh) playAlarmOnce(fresh.id);
  }, [data, profile?.alert_window_minutes]);

  if (loading) return <HomeSkeleton />;
  if (error) return <Card className="center"><p className="lead">We could not load your information.</p><Button onClick={reload}>Try again</Button></Card>;

  const { doses, appts, games, guardians, watching, meds, contacts, diary, past } = data;
  // Every number on this screen now comes from one place, so the header, the
  // counters, the glance chip and the calendar cannot drift apart. They used
  // to be computed separately here, which is how "0 of 3 taken" ended up
  // sitting above three cards that all said "Missed".
  const windowMinutes = profile?.alert_window_minutes ?? 60;
  const opts = { windowMinutes };
  const s = summarise(doses, opts);
  const { total, taken, missed, toTake, pct } = s;
  // The most urgent thing that can still be acted on, if there is one.
  const dueNow = sortForDisplay(s.actionable, opts)[0];
  const firstName = (profile?.full_name || 'there').split(' ')[0];
  const greeting = greetingFor();
  const completeness = profileCompleteness(profile);
  const placed = placeWidgets(layout.filter((w) => w.on).map((w) => w.id), { games });

  function renderWidget(id) {
    switch (id) {
      case 'quick':
        return <QuickCalls contacts={contacts} />;
      case 'feeling':
        return <FeelingWidget diary={diary} />;
      case 'today':
        return <TodayMeds doses={doses} summary={s} dueNow={dueNow} opts={opts} actions={actions} />;
      case 'diary':
        return <DiaryTile diary={diary} />;
      case 'nextVisit':
        return <NextVisit appt={appts[0]} />;
      case 'watching':
        return <WatchingWidget watching={watching} />;
      case 'glance':
        return (
          <section aria-label="Today at a glance">
            <h3 className="subsection" style={{ margin: '0 0 8px' }}>Today at a glance</h3>
            <div className="glance">
              <button className="glance__chip" onClick={() => navigate('/medication')}>
                <span className="glance__ic glance__ic--good"><Icon name="pill" size={22} /></span>
                <span className="glance__n">{taken} / {total}</span>
                <span className="glance__l">Medicines</span>
              </button>
              <button className="glance__chip" onClick={() => navigate('/appointments')}>
                <span className="glance__ic glance__ic--primary"><Icon name="calendar" size={22} /></span>
                <span className="glance__n">{appts.length}</span>
                <span className="glance__l">Appointments</span>
              </button>
              <button className="glance__chip" onClick={() => navigate('/games')}>
                <span className="glance__ic glance__ic--violet"><Icon name="brain" size={22} /></span>
                <span className="glance__n">{games}</span>
                <span className="glance__l">Brain Games</span>
              </button>
            </div>
          </section>
        );
      case 'week':
        // This week by default: seven days answer "how am I doing?" at a
        // glance, and the full month is one tap away for anyone who wants it.
        return (
          <section aria-label={fullMonth ? 'Medicine calendar for this month' : 'Medicines this week'}>
            <h3 className="subsection" style={{ margin: '0 0 8px' }}>{fullMonth ? 'Calendar' : 'This week'}</h3>
            {fullMonth ? (
              <>
                <MedCalendar selected={null} windowMinutes={windowMinutes} meds={meds}
                  onPick={(day) => navigate('/medication', { state: { view: 'calendar', day } })} />
                <button type="button" className="cal__today-btn" onClick={() => setFullMonth(false)}>Show just this week</button>
              </>
            ) : (
              <WeekStrip windowMinutes={windowMinutes} meds={meds} onMore={() => setFullMonth(true)}
                onPick={(day) => navigate('/medication', { state: { view: 'calendar', day } })} />
            )}
          </section>
        );
      case 'visitHistory':
        return <VisitHistory past={past} />;
      case 'games':
        return games === 0 ? (
          <Card className="nudge" onClick={() => navigate('/games')}>
            <Icon name="brain" size={28} />
            <span>You have not played a brain game today. A quick game keeps the mind sharp.</span>
            <Icon name="chevron" size={24} />
          </Card>
        ) : null;
      default:
        return null;
    }
  }


  return (
    <div className="stack">
      <section className="dayhero" aria-labelledby="hero-hi">
        <HeroScene />
        <h2 className="dayhero__hi" id="hero-hi">
          <span className="dayhero__greet">{greeting},</span>
          <span className="dayhero__name">{firstName}!<span className="hello__wave" aria-hidden="true">👋</span></span>
        </h2>
        <div className="dayhero__row">
          <p className="dayhero__date">{prettyDate(localDateStr())}</p>
          <button type="button" className="dayhero__today" aria-haspopup="dialog" onClick={() => setCalOpen(true)}>
            <Icon name="calendar" size={20} /> <span>Today</span> <Icon name="chevron" size={18} className="dayhero__chev" />
          </button>
        </div>
      </section>

      {/* Never fail silently: if this device cannot deliver reminders, the Home
          screen says so rather than letting someone believe they are covered. */}
      <ReminderWarning problem={reminderProblem} />

      {/* One urgent banner at a time: while reminders are broken, the guardian
          nudge shrinks to a single quiet line instead of stacking a second
          full card of things to do on arrival. */}
      <GuardianNudge guardians={guardians} quiet={!!reminderProblem.status} />

      {completeness.pct < 100 && (
        <Card onClick={() => navigate('/profile')} role="button" tabIndex={0} aria-label={`Profile progress ${completeness.pct} percent — open profile`}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/profile'); } }}>
          <div className="progress-card">
            <div className="progress-card__ring" style={{ '--p': completeness.pct }}><b>{completeness.pct}%</b></div>
            <div className="progress-card__main">
              <div className="progress-card__t">Profile progress</div>
              <div className="progress-card__d">Keep going! Complete your profile to get the most from MyDay.</div>
            </div>
            <Icon name="chevron" size={24} />
          </div>
        </Card>
      )}

      {/* Everything below is the person's own Home: widgets they can hide,
          show and reorder from "Edit Home". The urgent cards above stay. */}
      <div className="home-grid">
        {placed.map(({ id, span, tile }) => {
          const el = renderWidget(id);
          return el ? <div key={id} className={`home-w home-w--${id}${span ? ' home-w--full' : ''}${tile ? ' home-w--tile' : ''}`}>{el}</div> : null;
        })}
      </div>

      <button type="button" className="home-edit" onClick={() => setEditing(true)}>
        <Icon name="layout" size={20} /> <span>Edit Home</span>
      </button>
      {editing && <HomeEditor layout={layout} onChange={setLayout} onClose={() => setEditing(false)} />}
      {calOpen && (
        <Modal title="Your calendar" onClose={() => setCalOpen(false)}>
          <p className="muted" style={{ margin: '0 0 12px' }}>Tap a day to see its medicines.</p>
          <MedCalendar selected={localDateStr()} windowMinutes={windowMinutes} meds={meds}
            onPick={(day) => { setCalOpen(false); navigate('/medication', { state: { view: 'calendar', day } }); }} />
        </Modal>
      )}
    </div>
  );
}

// Shown only when something is actually wrong, and always with the fix for
// this exact device. Dismissable, because being nagged daily about an iPad you
// do not use for alerts is its own problem — but it comes back on a new device.
// Returns { status, hide } where status is null unless there is a real
// blocker on screen, so Home can quiet everything else while it shows.
function useReminderProblem(installed) {
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem('myday_reminder_warning_hidden') === '1'; } catch { return false; }
  });
  const status = deliveryStatus({
    supported: pushSupported(),
    permission: typeof Notification !== 'undefined' ? Notification.permission : 'default',
    installed,
    platform: platformTag(),
  });
  function hide() {
    setHidden(true);
    try { localStorage.setItem('myday_reminder_warning_hidden', '1'); } catch {}
  }
  // 'not_asked' is not a fault — they simply have not opted in, and Profile
  // asks properly. Only a real blocker is worth a Home-screen warning.
  const blocked = !status.ok && status.code !== 'not_asked' && !hidden;
  // A device that can receive alerts can still be muted by MyDay's own
  // settings. Not dismissable: a silent reminder is a missed dose.
  const muted = useMutedSettings();
  if (blocked) return { status, hide };
  if (muted) return { status: { ...muted, settings: true }, hide };
  return { status: null, hide };
}

function useMutedSettings() {
  const [prefs, setPrefs] = useState(null);
  useEffect(() => { getNotificationPrefs().then(setPrefs).catch(() => {}); }, []);
  if (!prefs) return null;
  if (prefs.master === false) {
    return { title: 'All reminders are turned off', message: 'MyDay will not remind you to take your medicine.', fix: 'Tap "Fix it" and switch reminders back on.' };
  }
  if (prefs.sound === false) {
    return { title: 'Reminders are silent', message: 'Sound is off, so reminders arrive without any noise.', fix: 'Tap "Fix it" and switch Sound on.' };
  }
  if (prefs.quiet_hours_enabled) {
    return {
      title: 'Quiet hours are on',
      message: `Medicine reminders are not sent between ${prettyTime(prefs.quiet_from)} and ${prettyTime(prefs.quiet_to)}.`,
      fix: 'If you take medicine then, tap "Fix it" and turn Quiet hours off.',
    };
  }
  return null;
}

function ReminderWarning({ problem }) {
  const navigate = useNavigate();
  const { status } = problem;
  if (!status) return null;

  return (
    <Card accent="missed" className="reminder-warn">
      <div className="reminder-warn__head">
        <span className="reminder-warn__ic"><Icon name="bell" size={22} /></span>
        <div>
          <div className="reminder-warn__t">{status.title || 'Reminders cannot reach this device'}</div>
          <p className="reminder-warn__d">{status.message} {status.fix}</p>
        </div>
      </div>
      <div className="btn-row">
        {!status.settings && <Button variant="ghost" size="sm" onClick={problem.hide}>Hide this</Button>}
        <Button size="sm" onClick={() => navigate('/profile', { state: { open: 'alerts' } })}>Fix it</Button>
      </div>
    </Card>
  );
}

// Nobody is watching out for missed doses yet: say so on Home, where it will
// be seen, with one tap to fix it. "Not now" quiets it for a week, not forever.
const GUARDIAN_NUDGE_KEY = 'myday_guardian_nudge_hidden_until';
function GuardianNudge({ guardians, quiet }) {
  const navigate = useNavigate();
  const [hidden, setHidden] = useState(() => {
    try { return Number(localStorage.getItem(GUARDIAN_NUDGE_KEY) || 0) > Date.now(); } catch { return false; }
  });
  if (!guardians || hidden || guardians.some((g) => g.deviceCount > 0)) return null;
  const waiting = guardians[0];
  const open = () => navigate('/profile', { state: { add: 'guardian', guardianId: waiting?.id } });

  if (quiet) {
    return (
      <button type="button" className="gnudge-line" onClick={open}>
        <Icon name="user" size={20} />
        <span>{waiting ? `Finish connecting ${waiting.name}` : 'Add a family guardian'} — when you're ready</span>
        <Icon name="chevron" size={20} />
      </button>
    );
  }

  return (
    <Card className="gnudge">
      <div className="gnudge__head">
        <span className="gnudge__ic"><Icon name="user" size={24} /></span>
        <div>
          <div className="gnudge__t">{waiting ? `Finish connecting ${waiting.name}` : 'Add a family guardian'}</div>
          <p className="gnudge__d">
            {waiting
              ? `${waiting.name} hasn't typed in their code yet. Show them a new one — it takes a minute.`
              : 'A family member gets an alert on their phone if you miss a medicine. It takes about a minute.'}
          </p>
        </div>
      </div>
      <div className="btn-row">
        <Button variant="ghost" size="sm" onClick={() => {
          setHidden(true);
          try { localStorage.setItem(GUARDIAN_NUDGE_KEY, String(Date.now() + 7 * 86400000)); } catch {}
        }}>Not now</Button>
        <Button size="sm" icon="plus" onClick={open}>
          {waiting ? 'Show code' : 'Set it up'}
        </Button>
      </div>
    </Card>
  );
}

// Skeleton that mirrors the Home layout (greeting, cards, glance chips).
function HomeSkeleton() {
  return (
    <div className="stack" role="status" aria-label="Loading your day">
      <div className="dayhero">
        <Skeleton h={28} w="45%" />
        <Skeleton h={34} w="35%" style={{ marginTop: 8 }} />
        <Skeleton h={14} w="45%" style={{ marginTop: 12 }} />
      </div>
      <div className="qcalls">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} h={104} r={18} />)}
      </div>
      <SkeletonCard lines={3} />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
function greetingFor() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

// ---------- Home widgets ----------

// Remembered on this device, like the other display choices.
const LAYOUT_KEY = 'myday_home_layout';
function useHomeLayout() {
  const [layout, setState] = useState(() => {
    try { return normalizeLayout(JSON.parse(localStorage.getItem(LAYOUT_KEY))); } catch { return normalizeLayout(null); }
  });
  function set(next) {
    setState(next);
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(next)); } catch {}
  }
  return [layout, set];
}

// On a wide screen, small widgets pair up side by side; one left without a
// partner takes the full row rather than leaving a hole beside it. The two
// small tiles (Next visit, Health diary) sit side by side even on a phone.
const HALF = new Set(['feeling', 'nextVisit', 'watching', 'glance', 'week', 'visitHistory', 'diary']);
const TILES = new Set(['nextVisit', 'diary']);
function placeWidgets(ids, { games }) {
  const shown = ids.filter((id) => id !== 'games' || games === 0);
  const out = [];
  for (let i = 0; i < shown.length; i++) {
    const id = shown[i];
    const next = shown[i + 1];
    if (TILES.has(id) && TILES.has(next)) {
      out.push({ id, span: false, tile: true }, { id: next, span: false, tile: true });
      i++;
    } else if (HALF.has(id) && HALF.has(next)) {
      out.push({ id, span: false }, { id: next, span: false });
      i++;
    } else {
      out.push({ id, span: true });
    }
  }
  return out;
}

// "How are you feeling today?" — one tap saves it to the health diary, with
// Undo. After that the card just says what they chose, for the rest of today.
function FeelingWidget({ diary }) {
  const ui = useUI();
  const navigate = useNavigate();
  const [answer, setAnswer] = useState(() => todaysMood(diary, localDateStr(), (iso) => localDateStr(undefined, new Date(iso))));
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(null);
  const [tip, setTip] = useState(false);

  async function pick(m) {
    setBusy(m.id);
    const prev = answer?.entry;
    try {
      const row = await saveDiary({ id: prev?.id, category: m.category, title: m.title, body: prev?.body, entry_at: prev?.entry_at });
      setAnswer({ mood: m, entry: row });
      setChanging(false);
      ui.toast(`Saved to Updates: ${m.title.toLowerCase()}.`, 'good', prev ? null : {
        label: 'Undo',
        onAction: async () => {
          try { await deleteDiary(row.id); setAnswer(null); } catch { ui.toast('Could not undo.', 'bad'); }
        },
      });
    } catch {
      ui.toast('Could not save. Please try again.', 'bad');
    } finally {
      setBusy(null);
    }
  }

  if (answer && !changing) {
    return (
      <Card className="mood-card">
        <div className="mood-done">
          <span className={`mood__ic mood--${answer.mood.id}`}><Icon name={answer.mood.icon} size={26} /></span>
          <div className="mood-done__main">
            <div className="mood-done__t">Today you felt: {answer.mood.label} <Icon name="check" size={18} stroke={2.6} /></div>
            <div className="mood-done__d">Saved to your health diary in Updates.</div>
          </div>
        </div>
        <div className="btn-row">
          <Button variant="ghost" size="sm" onClick={() => setChanging(true)}>Change</Button>
          <Button size="sm" icon="edit" onClick={() => navigate('/updates')}>Add details</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="mood-card">
      <div className="mood-card__head">
        <h3 className="mood-card__q" id="mood-q">How are you feeling today?</h3>
        <button type="button" className="icon-btn mood-card__info" aria-expanded={tip} aria-controls="mood-tip"
          aria-label="What happens when I tap one?" onClick={() => setTip((v) => !v)}>
          <Icon name="info" size={24} />
        </button>
      </div>
      {tip && <p className="muted mood-card__d" id="mood-tip">One tap saves it to your health diary in Updates. You can add details there.</p>}
      <div className="mood-grid" role="group" aria-labelledby="mood-q">
        {MOODS.map((m) => (
          <button key={m.id} type="button" className={`mood mood--${m.id}${answer?.mood.id === m.id ? ' is-on' : ''}`}
            aria-pressed={answer?.mood.id === m.id} disabled={!!busy} onClick={() => pick(m)}>
            <span className="mood__ic"><Icon name={busy === m.id ? 'clock' : m.icon} size={24} /></span>
            <span className="mood__l">{m.label}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}

// Small tile: the next appointment, or a nudge to add one.
function NextVisit({ appt }) {
  const navigate = useNavigate();
  if (!appt) {
    return (
      <button type="button" className="tile" onClick={() => navigate('/appointments', { state: { add: 'appt' } })}>
        <span className="tile__ic tile__ic--violet" aria-hidden="true"><Icon name="calendar" size={22} /></span>
        <span className="tile__main">
          <span className="tile__k">Next appointment</span>
          <span className="tile__t">Nothing booked</span>
          <span className="tile__d">Tap to add a visit</span>
        </span>
        <Icon name="chevron" size={20} className="tile__chev" />
      </button>
    );
  }
  const date = new Date(`${appt.appt_date}T00:00:00`);
  const when = `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}${appt.appt_time ? ` · ${prettyTime(appt.appt_time)}` : ''}`;
  return (
    <button type="button" className="tile" onClick={() => navigate('/appointments')}>
      <span className="tile__ic tile__ic--violet" aria-hidden="true"><Icon name="calendar" size={22} /></span>
      <span className="tile__main">
        <span className="tile__k">Next appointment<span className="sr-only">, {countdownLabel(appt.appt_date)}</span></span>
        <span className="tile__t">{appt.doctor_name || appt.reason || 'Appointment'}</span>
        <span className="tile__d">{when}</span>
      </span>
      <Icon name="chevron" size={20} className="tile__chev" />
    </button>
  );
}

// Small tile: the newest health-diary note, which opens Updates.
function DiaryTile({ diary }) {
  const navigate = useNavigate();
  const last = diary?.[0];
  return (
    <button type="button" className="tile" onClick={() => navigate('/updates')}>
      <span className="tile__ic tile__ic--blue" aria-hidden="true"><Icon name="notes" size={22} /></span>
      <span className="tile__main">
        <span className="tile__k">Health diary</span>
        <span className="tile__t">{last ? (last.title || 'Latest note') : 'No notes yet'}</span>
        <span className="tile__d">{last ? 'View your updates' : 'Write how you feel'}</span>
      </span>
      <Icon name="chevron" size={20} className="tile__chev" />
    </button>
  );
}

// Call family, the doctor or the pharmacy in one tap, from the contacts saved
// in Profile. Nobody saved yet: the tile opens the contact form with that
// kind already picked. 911 always asks first, so a pocket or a stray finger
// cannot ring it.
const QUICK = [
  { id: 'family', label: 'Call Family', icon: 'phone', tone: 'green', types: ['other'], add: 'other' },
  { id: 'doctor', label: 'Call Doctor', icon: 'plus', tone: 'blue', types: ['provider', 'clinic'], add: 'provider' },
  { id: 'pharmacy', label: 'Pharmacy', icon: 'pill', tone: 'violet', types: ['pharmacy'], add: 'pharmacy' },
];
function pickContact(contacts, types) {
  const callable = (contacts || []).filter((c) => types.includes(c.type) && telHref(c.phone));
  // An emergency contact of that kind first, then the first one saved.
  return callable.find((c) => c.is_emergency) || callable[0] || null;
}
function QuickCalls({ contacts }) {
  const navigate = useNavigate();
  const [sos, setSos] = useState(false);
  return (
    <section className="qcalls" aria-label="Quick calls">
      {QUICK.map((q) => {
        const c = pickContact(contacts, q.types);
        const inner = (
          <>
            <span className={`qcalls__ic qcalls__ic--${q.tone}`} aria-hidden="true"><Icon name={q.icon} size={28} stroke={2.6} /></span>
            <span className="qcalls__l">{q.label}</span>
          </>
        );
        return c
          ? <a key={q.id} className="qcalls__btn" href={telHref(c.phone)} aria-label={`${q.label}: ${c.name}, ${c.phone}`}>{inner}</a>
          : (
            <button key={q.id} type="button" className="qcalls__btn" aria-label={`${q.label}: no number saved yet — add one`}
              onClick={() => navigate('/profile', { state: { add: 'contact', contactType: q.add } })}>{inner}</button>
          );
      })}
      <button type="button" className="qcalls__btn" aria-haspopup="dialog" onClick={() => setSos(true)}>
        <span className="qcalls__ic qcalls__ic--red qcalls__ic--911" aria-hidden="true">911</span>
        <span className="qcalls__l">Emergency</span>
      </button>
      {sos && (
        <Modal title="Call 911?" onClose={() => setSos(false)}>
          <p className="dialog-msg">This calls emergency services. Only call if you or someone near you needs urgent help.</p>
          <a className="btn btn--danger-solid btn--lg btn--full" href="tel:911" onClick={() => setSos(false)}>
            <Icon name="phone" size={24} /> Call 911 now
          </a>
          <div style={{ height: 10 }} />
          <Button variant="ghost" onClick={() => setSos(false)}>Cancel</Button>
        </Modal>
      )}
    </section>
  );
}

// "Today's Medicines": how the day is going, the one dose that matters most
// right now, and a way into the full list. A missed dose gets its own big,
// coloured, tappable line, because it is the number that needs acting on.
function TodayMeds({ doses, summary: s, dueNow, opts, actions }) {
  const navigate = useNavigate();
  const scheduled = doses.filter((d) => !d.as_needed);
  if (!s.total) {
    return (
      <Card className="tmeds">
        <div className="tmeds__head"><h3 className="tmeds__t">Today's Medicines</h3></div>
        <p className="muted" style={{ margin: '0 0 12px' }}>No medicines scheduled today.</p>
        <Button variant="ghost" icon="plus" onClick={() => navigate('/medication', { state: { add: 'med' } })}>Add a medicine</Button>
      </Card>
    );
  }
  // What needs doing now; otherwise the next dose later today; otherwise the
  // last one taken, so the card always shows something real.
  const later = scheduled.filter((d) => doseState(d, opts) === 'upcoming')
    .sort((a, b) => String(a.scheduled_time).localeCompare(String(b.scheduled_time)));
  const done = scheduled.filter((d) => doseState(d, opts) === 'taken')
    .sort((a, b) => String(b.scheduled_time).localeCompare(String(a.scheduled_time)));
  const show = dueNow || later[0] || done[0];
  return (
    <Card className="tmeds">
      <div className="tmeds__head">
        <h3 className="tmeds__t">Today's Medicines</h3>
        <span className="tmeds__n">{s.taken} of {s.total} taken</span>
      </div>
      <div className="bar tmeds__bar" role="img" aria-label={`${s.taken} of ${s.total} doses taken`}>
        <div className="bar__fill" style={{ width: `${s.pct}%` }} />
      </div>
      {s.missed > 0 && (
        <button type="button" className="status__alert" onClick={() => navigate('/medication')}>
          <span className="status__alert-n" aria-hidden="true">{s.missed}</span>
          <span className="status__alert-t">
            <b>{s.missed === 1 ? '1 dose missed today' : `${s.missed} doses missed today`}</b>
            <small>Tap to review — you can still mark it if you took it late</small>
          </span>
          <Icon name="chevron" size={22} />
        </button>
      )}
      {show && (
        <ul className="drows tmeds__list">
          <DoseRow dose={show} actions={actions} windowMinutes={opts.windowMinutes} simple />
        </ul>
      )}
      <button type="button" className="tmeds__all" onClick={() => navigate('/medication')}>
        View All Medicines <Icon name="chevron" size={20} />
      </button>
    </Card>
  );
}

// The calm landscape behind the greeting: hills, a lake and a few pines.
// Decorative only, drawn in the theme's own colours so it works light or dark.
function HeroScene() {
  return (
    <svg className="dayhero__scene" viewBox="0 0 400 220" preserveAspectRatio="xMaxYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="hs-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="hs-sky1" />
          <stop offset="1" className="hs-sky2" />
        </linearGradient>
        <linearGradient id="hs-fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0.05" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.35" stopColor="#fff" stopOpacity="0.75" />
          <stop offset="0.6" stopColor="#fff" stopOpacity="1" />
        </linearGradient>
        <mask id="hs-mask"><rect width="400" height="220" fill="url(#hs-fade)" /></mask>
      </defs>
      <g mask="url(#hs-mask)">
        <rect width="400" height="220" fill="url(#hs-sky)" />
        <circle cx="300" cy="62" r="26" className="hs-sun" />
        <path d="M120 150l70-62 40 30 55-58 60 52 55-34v72z" className="hs-far" />
        <path d="M150 160l60-40 45 26 50-40 45 30 50-22v46z" className="hs-mid" />
        <rect x="120" y="158" width="280" height="62" className="hs-lake" />
        <path d="M190 172h70M280 182h60M220 194h90" className="hs-ripple" />
        <g className="hs-pine">
          <path d="M352 160l14-44 14 44z" /><path d="M370 162l12-36 12 36z" /><path d="M336 162l10-30 10 30z" />
          <path d="M386 160l8-26 8 26z" />
        </g>
      </g>
    </svg>
  );
}

function VisitHistory({ past }) {
  const navigate = useNavigate();
  return (
    <Card>
      <div className="w-head">
        <h3 className="subsection">Visit history</h3>
        <button type="button" className="w-link" onClick={() => navigate('/appointments')}>See all</button>
      </div>
      {past.length ? (
        <ul className="vh">
          {past.map((a) => {
            const d = new Date(`${a.appt_date}T00:00:00`);
            return (
              <li key={a.id} className="vh__row">
                <span className="vh__date" aria-hidden="true"><b>{d.getDate()}</b><small>{d.toLocaleDateString([], { month: 'short' })}</small></span>
                <span className="vh__main">
                  <b>{a.doctor_name || a.reason || 'Appointment'}</b>
                  <small>{prettyDate(a.appt_date)}{a.reason && a.doctor_name ? ` · ${a.reason}` : ''}</small>
                </span>
              </li>
            );
          })}
        </ul>
      ) : <p className="muted" style={{ margin: 0 }}>Your past appointments will show here.</p>}
    </Card>
  );
}

// People this account watches over as a guardian. Each person is a big,
// friendly row with their initials; nobody yet is one quiet line.
const WATCH_COLORS = ['#2563a8', '#18774c', '#a1520e', '#b3376c', '#6d3fd1', '#0f8f86'];
const colorFor = (name = '') => WATCH_COLORS[[...name].reduce((n, ch) => n + ch.charCodeAt(0), 0) % WATCH_COLORS.length];
function WatchingWidget({ watching }) {
  const navigate = useNavigate();
  // Nobody to watch: nothing on Home. "Become a guardian" lives in Profile.
  if (!watching.length) return null;
  return (
    <Card className="watch">
      <div className="w-head">
        <h3 className="subsection">People I watch</h3>
        <button type="button" className="w-link" onClick={() => navigate('/guardian')}>Manage</button>
      </div>
      <ul className="watch__list">
        {watching.map((person) => (
          <li key={person.id}>
            <button type="button" className="watch__person" aria-label={`Check on ${person.name}: see today's medicines and alerts`}
              onClick={() => navigate('/guardian', { state: { linkId: person.id } })}>
              <Avatar name={person.name} color={colorFor(person.name)} size={48} />
              <span className="watch__main">
                <b>{person.name}</b>
                <small>See today's medicines and alerts</small>
              </span>
              <Icon name="chevron" size={22} />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// "Edit Home": a switch to show or hide each widget, and arrows to move it.
function HomeEditor({ layout, onChange, onClose }) {
  function move(id, dir) {
    const next = moveWidget(layout, id, dir);
    onChange(next);
    // Keep focus on the arrow that was pressed as the row moves; at an end,
    // hand it to the other arrow instead of dropping it.
    requestAnimationFrame(() => {
      const same = document.getElementById(`w-${dir < 0 ? 'up' : 'down'}-${id}`);
      (same && !same.disabled ? same : document.getElementById(`w-${dir < 0 ? 'down' : 'up'}-${id}`))?.focus();
    });
  }
  return (
    <Modal title="Edit Home" onClose={onClose}
      footer={(
        <div className="btn-row">
          <Button variant="ghost" onClick={() => onChange(DEFAULT_LAYOUT.map((w) => ({ ...w })))}>Reset</Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      )}>
      <p className="muted" style={{ margin: '0 0 12px' }}>Turn things on or off, and use the arrows to change their order. Saved on this device.</p>
      <ol className="w-edit">
        {layout.map((w, i) => {
          const info = widgetInfo(w.id);
          const labelId = `w-edit-${w.id}`;
          return (
            <li key={w.id} className={`w-edit__row${w.on ? '' : ' is-off'}`}>
              <span className="w-edit__ic" aria-hidden="true"><Icon name={info.icon} size={22} /></span>
              <span className="w-edit__main">
                <span className="w-edit__t" id={labelId}>{info.name}</span>
                <span className="w-edit__d">{info.desc}</span>
              </span>
              <span className="w-edit__move">
                <button type="button" id={`w-up-${w.id}`} className="icon-btn w-edit__arrow" aria-label={`Move ${info.name} up`}
                  disabled={i === 0} onClick={() => move(w.id, -1)}><Icon name="up" size={20} /></button>
                <button type="button" id={`w-down-${w.id}`} className="icon-btn w-edit__arrow" aria-label={`Move ${info.name} down`}
                  disabled={i === layout.length - 1} onClick={() => move(w.id, 1)}><Icon name="down" size={20} /></button>
              </span>
              <Toggle checked={w.on} onChange={(v) => onChange(toggleWidget(layout, w.id, v))} labelledBy={labelId} />
            </li>
          );
        })}
      </ol>
    </Modal>
  );
}
