import { useEffect, useState } from 'react';
import { useDoseActions } from '../hooks/useDoseActions.js';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { useDayRefresh } from '../hooks/useDayRefresh.js';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Button, Avatar, Skeleton, SkeletonCard, Modal, Toggle } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { HeroArt } from '../components/HeroArt.jsx';
import { MedCalendar, WeekStrip } from '../components/MedCalendar.jsx';
import { DoseRow } from '../components/DoseRow.jsx';
import { getNotificationPrefs, todaysDoses, upcomingAppointments, pastAppointments, playedTodayCount, listGuardians, listMedications, listContacts, listDiary, saveDiary, deleteDiary } from '../lib/db.js';
import { prettyTime, prettyDate, localDateStr, present } from '../lib/format.js';
import { telHref } from '../lib/contacts.js';
import { countdownLabel } from '../lib/appointments.js';
import { MOODS, normalizeLayout, moveWidget, toggleWidget, todaysMood, widgetInfo, DEFAULT_LAYOUT, groupDoses } from '../lib/homeWidgets.js';
import { profileCompleteness } from '../lib/appearance.js';
import { summarise, doseState } from '../lib/doseState.js';
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
  const { total, taken } = s;
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
        // "My calendar": this week of medicines; the month opens from its title.
        return (
          <section className="hcard" aria-labelledby="w-cal-t">
            <button type="button" className="hcard__head" aria-haspopup="dialog" onClick={() => setCalOpen(true)}>
              <span className="hcard__ic" aria-hidden="true"><Icon name="calendar" size={22} /></span>
              <h3 className="hcard__t" id="w-cal-t">My calendar</h3>
              <Icon name="chevron" size={22} className="hcard__chev" />
            </button>
            <p className="hcard__month">{new Date().toLocaleDateString([], { month: 'long', year: 'numeric' })}</p>
            <WeekStrip windowMinutes={windowMinutes} meds={meds} onMore={() => setCalOpen(true)}
              onPick={(day) => navigate('/medication', { state: { view: 'calendar', day } })} />
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
    <div className="today stack">
      <section className="today-hero" aria-labelledby="hero-hi">
        <HeroArt />
        <div className="today-hero__text">
          <p className="today-hero__date"><Icon name="calendar" size={20} /> {prettyDate(localDateStr())}</p>
          <h2 className="today-hero__hi" id="hero-hi">{greeting}, {firstName}</h2>
          <p className="today-hero__sub">Here’s your MyDay for today.</p>
        </div>
      </section>

      {/* Never fail silently: if this device cannot deliver reminders, Today
          says so rather than letting someone believe they are covered. */}
      <ReminderWarning problem={reminderProblem} />

      {/* Medicines are the main task and always come first: the dominant
          column on a laptop, full width above everything else on a tablet or
          phone. Everything else is the person's own, arranged with Edit. */}
      <div className="today-grid">
        <div className="today-main">
          <TodayMedicines doses={doses} summary={s} opts={opts} actions={actions} />
        </div>
        <div className="today-side">
          {placed.map(({ id }) => {
            const el = renderWidget(id);
            return el ? <div key={id} className={`home-w home-w--${id}`}>{el}</div> : null;
          })}
          {/* Optional setup sits below the daily tasks, never above them. */}
          <GuardianNudge guardians={guardians} quiet={!!reminderProblem.status} />
          {completeness.pct < 100 && (
            <button type="button" className="setup-line" onClick={() => navigate('/profile')}>
              <span className="setup-line__ring" style={{ '--p': completeness.pct }} aria-hidden="true"><b>{completeness.pct}%</b></span>
              <span className="setup-line__main">
                <span className="setup-line__t">Finish your About me</span>
                <span className="setup-line__d">{completeness.pct}% complete</span>
              </span>
              <Icon name="chevron" size={20} />
            </button>
          )}
          <button type="button" className="home-edit" onClick={() => setEditing(true)}>
            <Icon name="layout" size={20} /> <span>Edit Home</span>
          </button>
        </div>
      </div>

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
    <div className="today stack" role="status" aria-label="Loading your day">
      <div className="today-hero">
        <div className="today-hero__text">
          <Skeleton h={16} w="40%" />
          <Skeleton h={34} w="60%" style={{ marginTop: 10 }} />
        </div>
      </div>
      <div className="today-grid">
        <div className="today-main"><SkeletonCard lines={5} /></div>
        <div className="today-side"><SkeletonCard lines={2} /><SkeletonCard lines={2} /></div>
      </div>
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

// The cards beside (laptop) or below (tablet, phone) Today's medicines. The
// grid around them decides the columns; the brain-game nudge only shows on a
// day without a game.
function placeWidgets(ids, { games }) {
  return ids.filter((id) => id !== 'games' || games === 0).map((id) => ({ id }));
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
      ui.toast(`Saved to your health diary: ${m.title.toLowerCase()}.`, 'good', prev ? null : {
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
            <div className="mood-done__d">Saved to your health diary.</div>
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
      {tip && <p className="muted mood-card__d" id="mood-tip">One tap saves it to your health diary. You can add details there.</p>}
      <div className="mood-grid" role="group" aria-labelledby="mood-q">
        {MOODS.map((m) => (
          <button key={m.id} type="button" className={`mood mood--${m.id}${answer?.mood.id === m.id ? ' is-on' : ''}`}
            aria-pressed={answer?.mood.id === m.id} disabled={!!busy} onClick={() => pick(m)}>
            <span className="mood__ic"><Icon name={busy === m.id ? 'clock' : m.icon} size={24} /></span>
            <span className="mood__l">{m.label}</span>
          </button>
        ))}
      </div>
      <button type="button" className="chat-link" onClick={() => navigate('/updates', { state: { chat: true } })}>
        <Icon name="chat" size={22} /> <span>Chat with MyDay</span> <Icon name="chevron" size={20} />
      </button>
    </Card>
  );
}

// The next appointment: who, when and where, or a clear way to add one.
function NextVisit({ appt }) {
  const navigate = useNavigate();
  const date = appt ? new Date(`${appt.appt_date}T00:00:00`) : null;
  return (
    <section className="hcard" aria-labelledby="w-visit-t">
      <button type="button" className="hcard__head" onClick={() => navigate('/appointments')}>
        <span className="hcard__ic" aria-hidden="true"><Icon name="calendar" size={22} /></span>
        <h3 className="hcard__t" id="w-visit-t">Next appointment</h3>
        <Icon name="chevron" size={22} className="hcard__chev" />
      </button>
      {appt ? (
        <div className="hcard__body">
          <p className="hcard__big">{appt.doctor_name || appt.reason || 'Appointment'}</p>
          <p className="hcard__line"><Icon name="clock" size={18} /> {date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}{appt.appt_time ? ` · ${prettyTime(appt.appt_time)}` : ''} <span className="sr-only">, {countdownLabel(appt.appt_date)}</span></p>
          {appt.location && <p className="hcard__line"><Icon name="pin" size={18} /> {appt.location}</p>}
          {appt.reason && appt.doctor_name && <p className="hcard__line hcard__line--soft">{appt.reason}</p>}
        </div>
      ) : (
        <div className="hcard__body hcard__body--empty">
          <p className="hcard__big">Nothing booked</p>
          <p className="hcard__line hcard__line--soft">Add a new appointment</p>
          <Button variant="ghost" icon="plus" onClick={() => navigate('/appointments', { state: { add: 'appt' } })}>Add appointment</Button>
        </div>
      )}
    </section>
  );
}

// Small tile: the newest health-diary note, which opens Health diary.
function DiaryTile({ diary }) {
  const navigate = useNavigate();
  const last = diary?.[0];
  return (
    <button type="button" className="tile" onClick={() => navigate('/updates')}>
      <span className="tile__ic tile__ic--blue" aria-hidden="true"><Icon name="notes" size={22} /></span>
      <span className="tile__main">
        <span className="tile__k">Health diary</span>
        <span className="tile__t">{last ? (present(last.title) || 'Latest note') : 'No notes yet'}</span>
        <span className="tile__d">{last ? 'Open your health diary' : 'Add health note'}</span>
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
  { id: 'family', label: 'Call family', empty: 'Add family contact', icon: 'phone', tone: 'green', types: ['other'], add: 'other' },
  { id: 'doctor', label: 'Call doctor', empty: 'Add doctor contact', icon: 'stethoscope', tone: 'blue', types: ['provider', 'clinic'], add: 'provider' },
  { id: 'pharmacy', label: 'Call pharmacy', empty: 'Add pharmacy', icon: 'pill', tone: 'violet', types: ['pharmacy'], add: 'pharmacy' },
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
    <section className="hcard contacts-w" aria-labelledby="contacts-w-t">
      <button type="button" className="hcard__head" onClick={() => navigate('/contacts')}>
        <span className="hcard__ic" aria-hidden="true"><Icon name="users" size={22} /></span>
        <h3 className="hcard__t" id="contacts-w-t">Contacts</h3>
        <Icon name="chevron" size={22} className="hcard__chev" />
      </button>
      <div className="qcalls">
        {QUICK.map((q) => {
          const c = pickContact(contacts, q.types);
          // No number saved: say so plainly, so it never looks like a ready call button.
          return c
            ? (
              <a key={q.id} className="qcalls__btn" href={telHref(c.phone)}>
                <span className={`qcalls__ic qcalls__ic--${q.tone}`} aria-hidden="true"><Icon name={q.icon} size={26} stroke={2.4} /></span>
                <span className="qcalls__l">{q.label}<span className="sr-only">:</span></span>
                <span className="qcalls__who" translate="no"> {c.name}<span className="sr-only">, {c.phone}</span></span>
              </a>
            ) : (
              <button key={q.id} type="button" className="qcalls__btn qcalls__btn--empty"
                onClick={() => navigate('/contacts', { state: { add: 'contact', contactType: q.add } })}>
                <span className="qcalls__ic qcalls__ic--add" aria-hidden="true"><Icon name="plus" size={24} stroke={2.4} /></span>
                <span className="qcalls__l">{q.empty}</span>
              </button>
            );
        })}
      </div>
      {/* Emergency is set apart from routine contacts and always asks first. */}
      <button type="button" className="sos-btn" aria-haspopup="dialog" onClick={() => setSos(true)}>
        <span className="sos-btn__ic" aria-hidden="true">911</span>
        <span className="sos-btn__l">Emergency call</span>
        <Icon name="chevron" size={20} />
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

// Today's medicines: every dose of the day, grouped by time of day with quiet
// labels, so the whole day reads at a glance and each dose can be recorded
// (or a mistake corrected) right here. The summary is compact and secondary:
// a line of words and a thin bar, never a score to feel bad about.
function TodayMedicines({ doses, summary: s, opts, actions }) {
  const navigate = useNavigate();
  const recorded = s.taken + s.skipped;
  const attention = s.missed + s.overdue;
  return (
    <section className="tmed" aria-labelledby="tmed-t">
      <header className="tmed__head">
        <span className="tmed__ic" aria-hidden="true"><Icon name="pill" size={24} /></span>
        <div className="tmed__titles">
          <h2 className="tmed__t" id="tmed-t">Today’s medicines</h2>
          <p className={`tmed__headline${attention ? ' tmed__headline--attn' : ''}`}>
            {attention > 0 && <Icon name="alert" size={18} />} {s.headline}
          </p>
        </div>
        {s.total > 0 && (
          <div className="tmed__progress">
            <span className="tmed__count">{recorded} of {s.total} recorded</span>
            <span className="bar tmed__bar" role="img" aria-label={`${recorded} of ${s.total} doses recorded today`}>
              <span className="bar__fill" style={{ width: `${Math.round((recorded / s.total) * 100)}%` }} />
            </span>
          </div>
        )}
      </header>

      {!s.total ? (
        <div className="tmed__empty">
          <p>No medicines are scheduled today.</p>
          <Button variant="ghost" icon="plus" onClick={() => navigate('/medication', { state: { add: 'med' } })}>Add medicine</Button>
        </div>
      ) : (
        groupDoses(doses).map((g) => (
          <div className="tmed__group" key={g.id} role="group" aria-labelledby={`tmed-g-${g.id}`}>
            <h3 className="tmed__gt" id={`tmed-g-${g.id}`}>{g.label}</h3>
            <ul className="drows">
              {g.doses.map((d) => <DoseRow key={d.id} dose={d} actions={actions} windowMinutes={opts.windowMinutes} />)}
            </ul>
          </div>
        ))
      )}

      <div className="tmed__foot">
        <button type="button" className="tmed__all" onClick={() => navigate('/medication')}>
          <Icon name="pill" size={22} /> Open Medicines <Icon name="chevron" size={20} />
        </button>
      </div>
    </section>
  );
}

function VisitHistory({ past }) {
  const navigate = useNavigate();
  return (
    <Card>
      <div className="w-head">
        <h3 className="subsection">Past appointments</h3>
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
