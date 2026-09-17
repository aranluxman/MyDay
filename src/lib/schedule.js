// When is a medicine actually due?
//
// Until now every medicine was simply "every day at these times". A course of
// antibiotics for ten days, a Monday/Thursday tablet and an as-needed painkiller
// were all stored the same way, so the app generated doses that were never
// really scheduled and then marked them missed.
//
// The same rules are implemented in SQL (myday_dose_due_on, migration 0009)
// because dose rows are generated server-side by the cron. These functions are
// the client's copy, used for the review step's plain-language summary and for
// the Medicines list. Both sides are tested against the same cases.

export const FREQUENCIES = [
  { id: 'daily', label: 'Every day' },
  { id: 'days_of_week', label: 'Certain days' },
  { id: 'alternate', label: 'Every other day' },
  { id: 'as_needed', label: 'Only when needed' },
];
export const FREQUENCY_IDS = FREQUENCIES.map((f) => f.id);

// Sunday-first, matching the calendar.
export const WEEKDAYS = [
  { dow: 0, short: 'Sun', label: 'Sunday' },
  { dow: 1, short: 'Mon', label: 'Monday' },
  { dow: 2, short: 'Tue', label: 'Tuesday' },
  { dow: 3, short: 'Wed', label: 'Wednesday' },
  { dow: 4, short: 'Thu', label: 'Thursday' },
  { dow: 5, short: 'Fri', label: 'Friday' },
  { dow: 6, short: 'Sat', label: 'Saturday' },
];

/** Preset times offered as chips. */
export const TIME_PRESETS = [
  { id: 'morning', time: '08:00', label: 'Morning' },
  { id: 'midday', time: '12:00', label: 'Midday' },
  { id: 'evening', time: '18:00', label: 'Evening' },
  { id: 'bedtime', time: '21:00', label: 'Bedtime' },
];

// Dates are handled as 'YYYY-MM-DD' throughout, never as Date objects, so a
// timezone can never shift a dose onto the wrong day.
const DAY = 86400000;

function toUTC(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return NaN;
  return Date.UTC(y, m - 1, d);
}

/** Day of week (0 = Sunday) for a 'YYYY-MM-DD' string. */
export function dowOf(iso) {
  const t = toUTC(iso);
  return Number.isFinite(t) ? new Date(t).getUTCDay() : null;
}

/** Whole days between two 'YYYY-MM-DD' strings. */
export function daysBetween(fromIso, toIso) {
  const a = toUTC(fromIso);
  const b = toUTC(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / DAY);
}

/**
 * Is this medicine due on this date?
 *
 * @param med  { frequency, days_of_week, start_date, end_date }
 * @param iso  'YYYY-MM-DD'
 */
export function isDueOn(med, iso) {
  if (!med || !iso) return false;
  const freq = med.frequency || 'daily';

  // As-needed medicines are never scheduled, so they never generate a dose
  // and can never be "missed". That was the whole point of the option.
  if (freq === 'as_needed') return false;

  // Outside the course, nothing is due. A ten-day course stops on day eleven
  // instead of generating missed doses forever.
  if (med.start_date && daysBetween(med.start_date, iso) < 0) return false;
  if (med.end_date && daysBetween(iso, med.end_date) < 0) return false;

  if (freq === 'days_of_week') {
    const days = Array.isArray(med.days_of_week) ? med.days_of_week.map(Number) : [];
    // No day chosen is not "every day": it is an incomplete schedule, and
    // inventing daily doses from it would be a surprise.
    if (!days.length) return false;
    return days.includes(dowOf(iso));
  }

  if (freq === 'alternate') {
    // Counted from the start date so "every other day" has a fixed phase;
    // without an anchor it would drift every time the code ran.
    const anchor = med.start_date || iso;
    const n = daysBetween(anchor, iso);
    if (n == null || n < 0) return false;
    return n % 2 === 0;
  }

  return true; // daily
}

/** Every date in [fromIso, toIso] on which the medicine is due. */
export function dueDatesBetween(med, fromIso, toIso) {
  const out = [];
  const a = toUTC(fromIso);
  const b = toUTC(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return out;
  for (let t = a; t <= b; t += DAY) {
    const iso = new Date(t).toISOString().slice(0, 10);
    if (isDueOn(med, iso)) out.push(iso);
  }
  return out;
}

/** Sorted, de-duplicated 'HH:MM' times. */
export function normaliseTimes(times) {
  const clean = (Array.isArray(times) ? times : [])
    .map((t) => String(t || '').trim())
    .filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t));
  return [...new Set(clean)].sort();
}

/** 'HH:MM' from hour/minute numbers. */
export function toTimeString(hour, minute) {
  const h = Math.min(23, Math.max(0, Number(hour) || 0));
  const m = Math.min(59, Math.max(0, Number(minute) || 0));
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** How many doses a course adds up to, or null when it never ends. */
export function courseLength(med) {
  if (!med?.start_date || !med?.end_date) return null;
  const days = dueDatesBetween(med, med.start_date, med.end_date).length;
  const perDay = normaliseTimes(med.times).length || 1;
  return { days, doses: days * perDay };
}

/**
 * The review step's sentence: "1 tablet of Vitamin D, every morning at 8:00,
 * with food". Written to be read aloud to someone, not parsed.
 */
export function describeSchedule(med, { prettyTime = (t) => t } = {}) {
  const freq = med.frequency || 'daily';
  const times = normaliseTimes(med.times);

  if (freq === 'as_needed') return 'only when you need it — no reminders';

  const when = times.length
    ? `at ${times.map(prettyTime).join(', ')}`
    : 'at no set time';

  let how;
  if (freq === 'alternate') how = 'every other day';
  else if (freq === 'days_of_week') {
    const days = (med.days_of_week || []).map(Number).sort();
    if (days.length === 7) how = 'every day';
    else if (days.length === 0) how = 'on no days yet';
    else if (isWeekdaysOnly(days)) how = 'every weekday';
    else if (isWeekendOnly(days)) how = 'at weekends';
    else how = `every ${days.map((d) => WEEKDAYS[d]?.label).filter(Boolean).join(', ')}`;
  } else how = 'every day';

  const parts = [`${how} ${when}`];

  if (med.start_date && med.end_date) {
    const c = courseLength(med);
    parts.push(`for ${c.days} day${c.days === 1 ? '' : 's'}`);
  } else if (med.end_date) {
    parts.push(`until ${med.end_date}`);
  } else if (med.start_date) {
    parts.push(`starting ${med.start_date}`);
  }

  if (med.with_food) parts.push('with food');
  return parts.join(', ');
}

const isWeekdaysOnly = (d) => d.length === 5 && d.every((x) => x >= 1 && x <= 5);
const isWeekendOnly = (d) => d.length === 2 && d.includes(0) && d.includes(6);

/**
 * Gentle, inline validation. Returns a list of { field, message } — never
 * throws, never blocks on anything recoverable, and never a dead end.
 */
export function validateMedicine(med) {
  const problems = [];
  if (!String(med.name || '').trim()) {
    problems.push({ field: 'name', message: 'What is this medicine called?' });
  }
  const freq = med.frequency || 'daily';
  const times = normaliseTimes(med.times);

  if (freq !== 'as_needed' && !times.length) {
    problems.push({ field: 'times', message: 'Pick at least one time of day, or choose "Only when needed".' });
  }
  if (freq === 'days_of_week' && !(med.days_of_week || []).length) {
    problems.push({ field: 'days', message: 'Which days of the week?' });
  }
  if (med.start_date && med.end_date && daysBetween(med.start_date, med.end_date) < 0) {
    problems.push({ field: 'end_date', message: 'The end date is before the start date.' });
  }
  return problems;
}
