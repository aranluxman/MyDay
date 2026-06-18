// MyDay - app entry point: service worker, routing, and the Home screen.
import { h, mount, banner } from './ui.js';
import { go } from './nav.js';
import {
  syncTimezone, refreshDoses, todaysDoses, markDoseTaken,
  upcomingAppointments, playedTodayCount, deviceTimezone,
  prettyTime, prettyDate, localDateStr,
} from './db.js';
import { renderMedications } from './medications.js';
import { renderAppointments } from './appointments.js';
import { renderGamesMenu, renderGame } from './games.js';
import { renderSettings } from './settings.js';

// ---------- service worker (PWA) ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// ---------- app bar chrome ----------
const els = {
  title: document.getElementById('appTitle'),
  back: document.getElementById('backBtn'),
  home: document.getElementById('homeBtn'),
};
els.back.addEventListener('click', () => history.back());
els.home.addEventListener('click', () => go('#/home'));

function setChrome(title, { back = false, home = true } = {}) {
  els.title.textContent = title;
  els.back.hidden = !back;
  els.home.hidden = !home;
}

// ---------- one-time daily refresh of dose rows ----------
let dosesReadyFor = null;
async function ensureDosesFresh() {
  const tz = deviceTimezone();
  const today = localDateStr(tz);
  if (dosesReadyFor === today) return;
  try { await refreshDoses(tz); dosesReadyFor = today; } catch (e) { console.warn(e); }
}

// ---------- Home screen ----------
async function renderHome() {
  setChrome('MyDay', { back: false, home: false });
  mount(h('p', { class: 'lead' }, 'Loading your day...'));

  await ensureDosesFresh();
  let doses = [], appts = [], gamesPlayed = 1;
  try {
    [doses, appts, gamesPlayed] = await Promise.all([
      todaysDoses(), upcomingAppointments(), playedTodayCount(),
    ]);
  } catch (e) {
    mount(errorCard('We could not load your information.', renderHome));
    return;
  }

  const taken = doses.filter(d => d.status === 'taken').length;
  const missed = doses.filter(d => d.status === 'missed').length;
  const pending = doses.filter(d => d.status === 'pending').length;

  // Most urgent dose that is due now or overdue and still not taken.
  const now = Date.now();
  const dueNow = doses
    .filter(d => d.status === 'pending' && new Date(d.due_at).getTime() <= now)
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))[0];

  const nodes = [];

  const todayStr = prettyDate(localDateStr());
  nodes.push(h('p', { class: 'lead' }, todayStr));

  // Prominent reminder with a single big Done button.
  if (dueNow) {
    nodes.push(reminderCard(dueNow, renderHome));
  }

  // Today's medication status at a glance.
  nodes.push(
    h('div', { class: 'status-grid' },
      stat('taken', taken, 'Taken'),
      stat('missed', missed, 'Missed'),
      stat('pending', pending, 'To take'),
    )
  );

  // Three large menu buttons.
  nodes.push(
    h('div', { class: 'menu' },
      menuButton('My Medications', medsSubtitle(taken, missed, pending), '#/meds'),
      menuButton('My Appointments', apptSubtitle(appts), '#/appts'),
      menuButton('Brain Games', gamesPlayed > 0 ? 'Play anytime' : 'A good time to play', '#/games'),
    )
  );

  // Gentle nudge to play only if he has not played today.
  if (gamesPlayed === 0) {
    nodes.push(h('p', { class: 'center muted', style: 'margin-top:18px' },
      'You have not played a brain game today. A quick game is a nice way to keep sharp.'));
  }

  // Quiet link to the family / settings area.
  nodes.push(h('div', { class: 'center', style: 'margin-top:24px' },
    h('button', { class: 'btn btn--ghost btn--sm', onclick: () => go('#/settings') }, 'Family & Settings')));

  mount(...nodes);
}

function stat(kind, num, label) {
  return h('div', { class: `stat stat--${kind}` },
    h('div', { class: 'stat__num' }, String(num)),
    h('div', { class: 'stat__label' }, label));
}

function menuButton(title, subtitle, route) {
  return h('button', { class: 'menu__btn', onclick: () => go(route) },
    title, subtitle ? h('small', {}, subtitle) : null);
}

function medsSubtitle(taken, missed, pending) {
  if (pending > 0) return `${pending} still to take today`;
  if (missed > 0) return `${taken} taken, ${missed} missed today`;
  if (taken > 0) return 'All taken for today';
  return 'View your medicines';
}

function apptSubtitle(appts) {
  if (!appts.length) return 'No upcoming visits';
  const a = appts[0];
  return `Next: ${prettyDate(a.appt_date)}`;
}

function reminderCard(dose, after) {
  const m = dose.medication || {};
  return h('div', { class: 'reminder' },
    h('div', { class: 'reminder__kicker' }, `Time for your ${prettyTime(dose.scheduled_time)} medicine`),
    h('div', { class: 'reminder__name' }, `${m.name || 'Medicine'}${m.dose ? ' - ' + m.dose : ''}`),
    m.note ? h('div', { class: 'reminder__note' }, m.note) : null,
    h('button', {
      class: 'btn btn--good btn--lg',
      onclick: async (e) => {
        e.target.disabled = true;
        try {
          await markDoseTaken(dose.id);
          banner('Great - marked as taken.');
          after();
        } catch { banner('Could not save. Please try again.', 'bad'); e.target.disabled = false; }
      },
    }, 'Done - I took it'),
  );
}

export function errorCard(msg, retry) {
  return h('div', { class: 'card center' },
    h('p', { class: 'lead' }, msg),
    retry ? h('button', { class: 'btn', onclick: retry }, 'Try again') : null);
}

// ---------- router ----------
async function router() {
  const hash = location.hash || '#/home';
  const [, top, sub] = hash.split('/'); // ['#','meds'] etc.

  if (hash.startsWith('#/games/')) {
    setChrome('Brain Games', { back: true, home: true });
    return renderGame(sub, setChrome);
  }
  switch (top) {
    case 'meds':     setChrome('My Medications', { home: true }); return renderMedications(setChrome);
    case 'appts':    setChrome('My Appointments', { home: true }); return renderAppointments(setChrome);
    case 'games':    setChrome('Brain Games', { home: true }); return renderGamesMenu(setChrome);
    case 'settings': setChrome('Family & Settings', { home: true }); return renderSettings(setChrome);
    case 'home':
    default:         return renderHome();
  }
}

window.addEventListener('hashchange', router);

// ---------- boot ----------
(async function boot() {
  try { await syncTimezone(); } catch (e) { console.warn('timezone sync failed', e); }
  router();
})();
