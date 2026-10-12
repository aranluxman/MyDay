import { useEffect, useState } from 'react';
import { useDoseActions } from '../hooks/useDoseActions.js';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { useDayRefresh } from '../hooks/useDayRefresh.js';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Button, Avatar, Skeleton, SkeletonCard } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { MedCalendar, WeekStrip } from '../components/MedCalendar.jsx';
import { todaysDoses, upcomingAppointments, playedTodayCount, listGuardians, listMedications, listContacts } from '../lib/db.js';
import { prettyTime, prettyDate, localDateStr } from '../lib/format.js';
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
  const reminderProblem = useReminderProblem(installed);
  const { data, loading, error, reload } = useAsync(async () => {
    // Guardians are a nudge, not the day: if they fail to load, show nothing.
    const [doses, appts, games, guardians, watching, meds, contacts] = await Promise.all([
      todaysDoses(), upcomingAppointments(), playedTodayCount(), listGuardians().catch(() => null),
      listAccountGuardians().catch(() => []), listMedications().catch(() => []), listContacts().catch(() => null),
    ]);
    return { doses, appts, games, guardians, watching, meds, contacts };
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

  const { doses, appts, games, guardians, watching, meds, contacts } = data;
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

      <section className="home-watching" aria-label="People I watch">
          <h3 className="subsection">People I watch</h3>
          {!watching.length && <p className="muted">Helping someone with their medicines? Enter their guardian code to check on them here.</p>}
          {watching.map((person) => (
            <button key={person.id} type="button" className="home-watching__person"
              onClick={() => navigate('/guardian', { state: { linkId: person.id } })}>
              <span><b>Check on {person.name}</b><small>See their medicine updates</small></span>
              <Icon name="chevron" size={22} />
            </button>
          ))}
          <button type="button" className="home-watching__all" onClick={() => navigate('/guardian')}>
            {watching.length ? 'Manage guardian connections' : 'Enter a guardian code'}
          </button>
      </section>

      {/* From 768px the glance chips and the calendar sit side by side rather
          than stacking into a long scroll on a wide screen. */}
      <div className="two-col">
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

      {/* This week by default: seven days answer "how am I doing?" at a glance,
          and the full month is one tap away for anyone who wants it. */}
      {(
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
      )}

      </div>

      {games === 0 && (
        <Card className="nudge" onClick={() => navigate('/games')}>
          <Icon name="brain" size={28} />
          <span>You have not played a brain game today. A quick game keeps the mind sharp.</span>
          <Icon name="chevron" size={24} />
        </Card>
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
