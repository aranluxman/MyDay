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
import { todaysDoses, upcomingAppointments, pastAppointments, playedTodayCount, listGuardians, listMedications, listContacts, listDiary, saveDiary, deleteDiary } from '../lib/db.js';
import { prettyTime, prettyDate, localDateStr } from '../lib/format.js';
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
      case 'feeling':
        return <FeelingWidget diary={diary} />;
      case 'today':
        return (
          <div className="stack home-today">
            {dueNow && (
              <Card accent={STATE_UI[doseState(dueNow, opts)].tone} className="reminder">
                <div className="reminder__kicker">
                  {doseState(dueNow, opts) === 'overdue'
                    ? `Overdue — your ${prettyTime(dueNow.scheduled_time)} medicine`
                    : `Time for your ${prettyTime(dueNow.scheduled_time)} medicine`}
                </div>
                <div className="reminder__name" translate="no">{dueNow.medication?.name}{dueNow.medication?.dose ? ` - ${dueNow.medication.dose}` : ''}</div>
                {dueNow.medication?.note && <div className="reminder__note">{dueNow.medication.note}</div>}
                <Button variant="good" size="lg" icon={actions.pending.has(dueNow.id) ? 'clock' : 'check'}
                  disabled={actions.pending.has(dueNow.id)}
                  aria-label={`Done - I took it: ${dueNow.medication?.name || 'this medicine'}, ${prettyTime(dueNow.scheduled_time)} dose`}
                  onClick={() => actions.take(dueNow)}>{actions.pending.has(dueNow.id) ? 'Saving…' : 'Done - I took it'}</Button>
              </Card>
            )}
            {total === 0 ? (
              <Card>
                <div className="row-card">
                  <span className="row-card__ic"><Icon name="pill" size={24} /></span>
                  <div className="row-card__main">
                    <div className="row-card__t">Today's medicines</div>
                    <div className="row-card__d">No medicines scheduled. Tap to add your first medicine.</div>
                  </div>
                  <button className="row-card__add" aria-label="Add a medicine"
                    onClick={() => navigate('/medication', { state: { add: 'med' } })}>
                    <Icon name="plus" size={24} stroke={2.5} />
                  </button>
                </div>
              </Card>
            ) : (
              <Card className="status" accent={missed ? 'missed' : undefined}>
                {/* Missed doses are the one number that needs doing something about,
                    so they get a big, coloured, tappable badge of their own rather
                    than sitting as one of three equal counters. */}
                {missed > 0 && (
                  <button type="button" className="status__alert" onClick={() => navigate('/medication')}>
                    <span className="status__alert-n" aria-hidden="true">{missed}</span>
                    <span className="status__alert-t">
                      <b>{missed === 1 ? '1 dose missed today' : `${missed} doses missed today`}</b>
                      <small>Tap to review — you can still mark it if you took it late</small>
                    </span>
                    <Icon name="chevron" size={22} />
                  </button>
                )}
                <div className="status__head">
                  {/* State first, score second: "0 of 3 taken" reads as failure at
                      eight in the morning, when the truth is "3 doses to take". */}
                  <span>{missed > 0 ? "Today's medicines" : s.headline}</span>
                  <span className="status__count">{taken} of {total}</span>
                </div>
                <div className="bar"><div className="bar__fill" style={{ width: `${pct}%` }} /></div>
                <div className="status__row">
                  <Stat kind="taken" n={taken} label="Taken" icon="check" />
                  <Stat kind="missed" n={missed} label="Missed" icon="close" />
                  <Stat kind="pending" n={toTake} label="To take" icon="clock" />
                </div>
              </Card>
            )}
          </div>
        );
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
      <div className="hello">
        <div>
          <h2 className="hello__name">{greeting}, {firstName}!<span className="hello__wave" aria-hidden="true">👋</span></h2>
          <p className="hello__date">{prettyDate(localDateStr())}</p>
        </div>
        <button className="hello__avatar" onClick={() => navigate('/profile')} aria-label="Profile">
          <Avatar name={profile?.full_name} color={profile?.avatar_color} size={52} src={profile?.avatar_url} />
        </button>
      </div>

      {/* Never fail silently: if this device cannot deliver reminders, the Home
          screen says so rather than letting someone believe they are covered. */}
      <ReminderWarning problem={reminderProblem} />

      {/* One urgent banner at a time: while reminders are broken, the guardian
          nudge shrinks to a single quiet line instead of stacking a second
          full card of things to do on arrival. */}
      <ContactsNudge contacts={contacts} />

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
        {placed.map(({ id, span }) => {
          const el = renderWidget(id);
          return el ? <div key={id} className={`home-w home-w--${id}${span ? ' home-w--full' : ''}`}>{el}</div> : null;
        })}
      </div>

      <button type="button" className="home-edit" onClick={() => setEditing(true)}>
        <Icon name="layout" size={20} /> <span>Edit Home</span>
      </button>
      {editing && <HomeEditor layout={layout} onChange={setLayout} onClose={() => setEditing(false)} />}
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
  return { status: blocked ? status : null, hide };
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
          <div className="reminder-warn__t">Reminders cannot reach this device</div>
          <p className="reminder-warn__d">{status.message} {status.fix}</p>
        </div>
      </div>
      <div className="btn-row">
        <Button variant="ghost" size="sm" onClick={problem.hide}>Hide this</Button>
        <Button size="sm" onClick={() => navigate('/profile/notifications')}>Fix it</Button>
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

// No one to call yet: a pharmacy, doctor or family number should be one tap
// away before it is needed. Shown until any contact is saved; "Not now" quiets
// it for a week.
const CONTACTS_NUDGE_KEY = 'myday_contacts_nudge_hidden_until';
function ContactsNudge({ contacts }) {
  const navigate = useNavigate();
  const [hidden, setHidden] = useState(() => {
    try { return Number(localStorage.getItem(CONTACTS_NUDGE_KEY) || 0) > Date.now(); } catch { return false; }
  });
  if (!contacts || contacts.length || hidden) return null;
  return (
    <Card className="gnudge">
      <div className="gnudge__head">
        <span className="gnudge__ic"><Icon name="phone" size={24} /></span>
        <div>
          <div className="gnudge__t">Add someone to call</div>
          <p className="gnudge__d">Save a family member, your doctor or your pharmacy so help is one tap away.</p>
        </div>
      </div>
      <div className="btn-row">
        <Button variant="ghost" size="sm" onClick={() => {
          setHidden(true);
          try { localStorage.setItem(CONTACTS_NUDGE_KEY, String(Date.now() + 7 * 86400000)); } catch {}
        }}>Not now</Button>
        <Button size="sm" icon="plus" onClick={() => navigate('/profile', { state: { add: 'contact' } })}>Add a contact</Button>
      </div>
    </Card>
  );
}

// Skeleton that mirrors the Home layout (greeting, cards, glance chips).
function HomeSkeleton() {
  return (
    <div className="stack" role="status" aria-label="Loading your day">
      <div className="hello">
        <div style={{ flex: 1 }}>
          <Skeleton h={28} w="55%" />
          <Skeleton h={14} w="45%" style={{ marginTop: 8 }} />
        </div>
        <Skeleton h={52} w={52} r={26} />
      </div>
      <SkeletonCard lines={2} />
      <div className="glance">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} h={110} r={18} />)}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
// Colour, an icon and a word together; a counter only lights up when it is
// above zero, so a row of zeros stays calm.
function Stat({ kind, n, label, icon }) {
  return (
    <div className={`stat stat--${kind}${n > 0 ? ' is-on' : ''}`}>
      <div className="stat__num">{n}</div>
      <div className="stat__label"><Icon name={icon} size={14} stroke={2.5} /> {label}</div>
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
// partner takes the full row rather than leaving a hole beside it.
const HALF = new Set(['feeling', 'nextVisit', 'watching', 'glance', 'week', 'visitHistory']);
function placeWidgets(ids, { games }) {
  const shown = ids.filter((id) => id !== 'games' || games === 0);
  const out = [];
  for (let i = 0; i < shown.length; i++) {
    const id = shown[i];
    if (HALF.has(id) && HALF.has(shown[i + 1])) {
      out.push({ id, span: false }, { id: shown[i + 1], span: false });
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
      <h3 className="mood-card__q" id="mood-q">How are you feeling today?</h3>
      <p className="muted mood-card__d">One tap saves it to your health diary.</p>
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

function NextVisit({ appt }) {
  const navigate = useNavigate();
  if (!appt) {
    return (
      <Card>
        <div className="row-card">
          <span className="row-card__ic"><Icon name="calendar" size={24} /></span>
          <div className="row-card__main">
            <div className="row-card__t">Next visit</div>
            <div className="row-card__d">Nothing booked. Add your next check-up and MyDay will remind you.</div>
          </div>
          <button className="row-card__add" aria-label="Add a visit" onClick={() => navigate('/appointments', { state: { add: 'appt' } })}>
            <Icon name="plus" size={24} stroke={2.5} />
          </button>
        </div>
      </Card>
    );
  }
  const when = appt.appt_time ? `${prettyDate(appt.appt_date)} at ${prettyTime(appt.appt_time)}` : prettyDate(appt.appt_date);
  const date = new Date(`${appt.appt_date}T00:00:00`);
  return (
    <Card className="visit-w">
      <button type="button" className="visit-w__btn" onClick={() => navigate('/appointments')}>
        <span className="appt__date" aria-hidden="true">
          <span className="appt__d">{date.getDate()}</span>
          <span className="appt__m">{date.toLocaleDateString([], { month: 'short' })}</span>
        </span>
        <span className="visit-w__main">
          <span className="visit-w__k">Next visit · {countdownLabel(appt.appt_date)}</span>
          <span className="visit-w__t">{appt.doctor_name || appt.reason || 'Appointment'}</span>
          <span className="visit-w__d">{when}{appt.location ? ` · ${appt.location}` : ''}</span>
        </span>
        <Icon name="chevron" size={22} />
      </button>
    </Card>
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
  if (!watching.length) {
    return (
      <button type="button" className="watch-empty" onClick={() => navigate('/guardian')}>
        <span className="watch-empty__ic"><Icon name="shield" size={22} /></span>
        <span className="watch-empty__main">
          <b>Helping someone with their medicines?</b>
          <small>Enter their guardian code to check on them here.</small>
        </span>
        <Icon name="chevron" size={22} />
      </button>
    );
  }
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
