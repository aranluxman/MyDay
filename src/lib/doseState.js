// One source of truth for "what is the state of this dose?".
//
// Home, Medication and the guardian dashboard each used to derive this
// themselves, which is why they could disagree: Home split doses into
// taken/missed/pending, the calendar collapsed a whole day to the single worst
// status, and nothing anywhere distinguished "due twenty minutes ago" from
// "due tonight". Both screens were telling the truth about different things.
//
// Pure functions, no React and no Supabase, so this is the part that gets
// tested directly (see test/doseState.test.js).

// Ordered worst-first: a list of states can be reduced with `mostUrgent`.
export const DOSE_STATES = ['missed', 'overdue', 'due', 'upcoming', 'taken'];

// How long before its scheduled time a dose starts reading as "due now"
// rather than "later today".
export const DUE_SOON_MINUTES = 30;

// The user's missed-dose window (myday_profiles.alert_window_minutes) decides
// when pending becomes missed. 60 matches the column default.
export const DEFAULT_WINDOW_MINUTES = 60;

const MINUTE = 60_000;

/**
 * State of a single dose row.
 *
 * The server (cron + myday_refresh_doses) is what actually writes 'missed',
 * but it only runs every five minutes, so a page left open would otherwise sit
 * on a stale 'pending'. Recomputing the same rule here means the screen agrees
 * with what the server is about to store, instead of lagging behind it.
 *
 * @param {{status: string, due_at: string, taken_at?: string|null}} dose
 * @param {{now?: number, windowMinutes?: number}} [opts]
 * @returns {'taken'|'missed'|'overdue'|'due'|'upcoming'}
 */
export function doseState(dose, opts = {}) {
  if (!dose) return 'upcoming';
  if (dose.status === 'taken') return 'taken';

  const now = opts.now ?? Date.now();
  const windowMinutes = normaliseWindow(opts.windowMinutes);
  const dueAt = new Date(dose.due_at).getTime();

  // An unparseable due_at must not silently become "missed" and fire an alert.
  if (!Number.isFinite(dueAt)) return dose.status === 'missed' ? 'missed' : 'upcoming';

  if (now > dueAt + windowMinutes * MINUTE) return 'missed';
  // Trust a server-set 'missed' even inside the window: the person may have a
  // shorter window on another device, and demoting it would flap.
  if (dose.status === 'missed') return 'missed';
  if (now >= dueAt) return 'overdue';
  if (now >= dueAt - DUE_SOON_MINUTES * MINUTE) return 'due';
  return 'upcoming';
}

function normaliseWindow(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_WINDOW_MINUTES;
}

/** Worst (most urgent) of a set of states, or null for an empty set. */
export function mostUrgent(states) {
  for (const s of DOSE_STATES) if (states.includes(s)) return s;
  return null;
}

/**
 * Counts for a day's doses, plus the headline the UI should lead with.
 *
 * Every number the Home header, the glance chips, the progress bar and the
 * guardian status card show comes from here, so they cannot drift apart.
 */
export function summarise(doses, opts = {}) {
  const list = Array.isArray(doses) ? doses : [];
  const states = list.map((d) => doseState(d, opts));

  const count = (s) => states.filter((x) => x === s).length;
  const taken = count('taken');
  const missed = count('missed');
  const overdue = count('overdue');
  const due = count('due');
  const upcoming = count('upcoming');
  const total = list.length;

  // What still needs doing: anything not taken and not already written off.
  const toTake = overdue + due + upcoming;

  return {
    total, taken, missed, overdue, due, upcoming, toTake,
    // Doses whose time has come and gone but are still inside the window —
    // the ones a single big button should act on.
    actionable: list.filter((d, i) => states[i] === 'overdue' || states[i] === 'due'),
    pct: total ? Math.round((taken / total) * 100) : 0,
    allTaken: total > 0 && taken === total,
    headline: headlineFor({ total, taken, missed, overdue, due }),
    states,
  };
}

/**
 * Plain-language state of the day. Deliberately not a score: "0 of 3 taken"
 * reads as failure first thing in the morning, when the honest message is
 * "3 doses to take today".
 */
export function headlineFor({ total, taken, missed, overdue, due }) {
  if (!total) return 'No medicines scheduled today';
  if (taken === total) return 'All doses taken today';
  if (missed) return `${missed} dose${missed === 1 ? '' : 's'} missed today`;
  if (overdue) return `${overdue} dose${overdue === 1 ? '' : 's'} overdue`;
  if (due) return `${due} dose${due === 1 ? '' : 's'} due now`;
  const left = total - taken;
  if (taken) return `${left} dose${left === 1 ? '' : 's'} still to take`;
  return `${total} dose${total === 1 ? '' : 's'} to take today`;
}

/**
 * Calendar mark for a day.
 *
 * The old rule was missed > pending > taken, so a day with two taken and one
 * missed marked as wholly missed and contradicted the header. 'partial' keeps
 * a mixed day legible instead of rounding it to the worst thing that happened.
 *
 * @returns {'none'|'taken'|'partial'|'missed'|'pending'}
 */
export function dayMark(doses, opts = {}) {
  const list = Array.isArray(doses) ? doses : [];
  if (!list.length) return 'none';
  const s = summarise(list, opts);
  if (s.taken === s.total) return 'taken';
  if (s.missed && s.taken) return 'partial';
  if (s.missed) return 'missed';
  return 'pending';
}

/** Same rule, from the aggregate the calendar query returns per day. */
export function dayMarkFromCounts({ taken = 0, missed = 0, pending = 0 } = {}) {
  const total = taken + missed + pending;
  if (!total) return 'none';
  if (taken === total) return 'taken';
  if (missed && taken) return 'partial';
  if (missed) return 'missed';
  return 'pending';
}

// Presentation for each state: colour token, icon and words. Every surface
// pulls from here so a state never reads as one thing on Home and another in
// the guardian dashboard — and so state is never carried by colour alone.
export const STATE_UI = {
  taken:    { label: 'Taken',    icon: 'check',  tone: 'taken',   kind: 'taken' },
  missed:   { label: 'Missed',   icon: 'close',  tone: 'missed',  kind: 'missed' },
  overdue:  { label: 'Overdue',  icon: 'clock',  tone: 'overdue', kind: 'missed' },
  due:      { label: 'Due now',  icon: 'clock',  tone: 'due',     kind: 'pending' },
  upcoming: { label: 'To take',  icon: 'clock',  tone: 'upcoming', kind: 'pending' },
};

/** Sorts doses for display: what needs doing first, then the rest by time. */
export function sortForDisplay(doses, opts = {}) {
  const rank = { overdue: 0, due: 1, upcoming: 2, missed: 3, taken: 4 };
  return [...(doses || [])].sort((a, b) => {
    const ra = rank[doseState(a, opts)] ?? 9;
    const rb = rank[doseState(b, opts)] ?? 9;
    if (ra !== rb) return ra - rb;
    return new Date(a.due_at) - new Date(b.due_at);
  });
}

/** Adherence over a set of dose rows, for "taken 19 of 21 doses". */
export function adherence(doses, opts = {}) {
  const list = Array.isArray(doses) ? doses : [];
  // Doses still in the future aren't a miss yet, so they don't belong in the
  // denominator — otherwise every morning starts at 0%.
  const settled = list.filter((d) => {
    const s = doseState(d, opts);
    return s === 'taken' || s === 'missed';
  });
  const taken = settled.filter((d) => doseState(d, opts) === 'taken').length;
  return {
    taken,
    total: settled.length,
    pct: settled.length ? Math.round((taken / settled.length) * 100) : null,
  };
}
