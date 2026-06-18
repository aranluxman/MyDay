// Home: today's medication status at a glance + the three big menu buttons,
// with a prominent reminder (and one big Done button) when a dose is due now.
import { html, useState } from './react.js';
import { Button, Card, Icon, Spinner, useUI, useAsync, navigate } from './ui.js';
import {
  refreshDoses, todaysDoses, upcomingAppointments, playedTodayCount, markDoseTaken,
  deviceTimezone, prettyTime, prettyDate, localDateStr,
} from './db.js';

export function Home() {
  const ui = useUI();
  const { data, loading, error, reload } = useAsync(async () => {
    await refreshDoses(deviceTimezone());
    const [doses, appts, games] = await Promise.all([
      todaysDoses(), upcomingAppointments(), playedTodayCount(),
    ]);
    return { doses, appts, games };
  });

  if (loading) return html`<${Spinner} label="Loading your day..." />`;
  if (error) return html`<${Card} className="center"><p class="lead">We could not load your information.</p>
    <${Button} onClick=${reload}>Try again<//><//>`;

  const { doses, appts, games } = data;
  const taken = doses.filter((d) => d.status === 'taken').length;
  const missed = doses.filter((d) => d.status === 'missed').length;
  const pending = doses.filter((d) => d.status === 'pending').length;
  const total = doses.length;

  const now = Date.now();
  const dueNow = doses
    .filter((d) => d.status === 'pending' && new Date(d.due_at).getTime() <= now)
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))[0];

  return html`<div class="stack">
    <p class="today-date">${prettyDate(localDateStr())}</p>

    ${dueNow ? html`<${Reminder} dose=${dueNow} onDone=${async () => {
      try { await markDoseTaken(dueNow.id); ui.toast('Great - marked as taken.'); reload(); }
      catch { ui.toast('Could not save. Please try again.', 'bad'); }
    }} />` : null}

    <${StatusCard} taken=${taken} missed=${missed} pending=${pending} total=${total} />

    <nav class="menu">
      <${MenuButton} icon="pill" title="My Medications" subtitle=${medsSubtitle(taken, missed, pending, total)} to="#/meds" />
      <${MenuButton} icon="calendar" title="My Appointments" subtitle=${apptSubtitle(appts)} to="#/appts" />
      <${MenuButton} icon="brain" title="Brain Games" subtitle=${games > 0 ? 'Play anytime' : 'A good time to play'} to="#/games" />
    </nav>

    ${games === 0 ? html`<p class="nudge">You have not played a brain game today. A quick game is a nice way to keep sharp.</p>` : null}

    <${Button} variant="ghost" size="sm" full=${false} icon="bell"
      onClick=${() => navigate('#/settings')}>Family & Settings<//>
  </div>`;
}

function Reminder({ dose, onDone }) {
  const [busy, setBusy] = useState(false);
  const m = dose.medication || {};
  return html`<${Card} accent="due" className="reminder">
    <div class="reminder__kicker">Time for your ${prettyTime(dose.scheduled_time)} medicine</div>
    <div class="reminder__name">${m.name || 'Medicine'}${m.dose ? ' - ' + m.dose : ''}</div>
    ${m.note ? html`<div class="reminder__note">${m.note}</div>` : null}
    <${Button} variant="good" size="lg" icon="check" disabled=${busy}
      onClick=${async () => { setBusy(true); await onDone(); }}>Done - I took it<//>
  <//>`;
}

function StatusCard({ taken, missed, pending, total }) {
  const pct = total ? Math.round((taken / total) * 100) : 0;
  return html`<${Card} className="status">
    <div class="status__head">
      <span>Today's medicines</span>
      <span class="status__count">${taken} of ${total || 0} taken</span>
    </div>
    <div class="bar"><div class="bar__fill" style=${{ width: pct + '%' }}></div></div>
    <div class="status__row">
      <${Stat} kind="taken" n=${taken} label="Taken" />
      <${Stat} kind="missed" n=${missed} label="Missed" />
      <${Stat} kind="pending" n=${pending} label="To take" />
    </div>
  <//>`;
}
function Stat({ kind, n, label }) {
  return html`<div class=${`stat stat--${kind}`}>
    <div class="stat__num">${n}</div><div class="stat__label">${label}</div></div>`;
}

function MenuButton({ icon, title, subtitle, to }) {
  return html`<button class="menu__btn" onClick=${() => navigate(to)}>
    <span class="menu__icon"><${Icon} name=${icon} size=${30} /></span>
    <span class="menu__text"><span class="menu__title">${title}</span>
      <span class="menu__sub">${subtitle}</span></span>
    <span class="menu__chev"><${Icon} name="chevron" size=${26} /></span>
  </button>`;
}

function medsSubtitle(taken, missed, pending, total) {
  if (!total) return 'View your medicines';
  if (pending > 0) return `${pending} still to take today`;
  if (missed > 0) return `${taken} taken, ${missed} missed today`;
  return 'All taken for today';
}
function apptSubtitle(appts) {
  if (!appts.length) return 'No upcoming visits';
  return `Next: ${prettyDate(appts[0].appt_date)}`;
}
