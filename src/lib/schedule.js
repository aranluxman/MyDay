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
  // `days` is the number of days a dose is due (5 for a ten-day every-other-day
  // course); `calendarDays` is how long the course runs (10).
  return { days, doses: days * perDay, calendarDays: courseDays(med.start_date, med.end_date) };
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
    const n = courseDays(med.start_date, med.end_date);
    if (n) parts.push(`for ${n} day${n === 1 ? '' : 's'}`);
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

/** A real calendar date written as YYYY-MM-DD (2026-02-30 is not one). */
export function isIsoDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/**
 * 'YYYY-MM-DD' that is `days` after `iso` (day 1 = iso itself when days = n-1).
 * Pure UTC arithmetic, so a DST change can never move it by a day.
 */
export function addDays(iso, days) {
  const t = toUTC(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t + days * DAY).toISOString().slice(0, 10);
}

/** "for 10 days" starting `start` ends on day 10, i.e. start + 9. */
export function courseEndDate(start, nDays) {
  const n = Number(nDays);
  if (!isIsoDate(start) || !Number.isInteger(n) || n < 1) return null;
  return addDays(start, n - 1);
}

/** Inclusive number of calendar days from start to end, or null. */
export function courseDays(start, end) {
  if (!isIsoDate(start) || !isIsoDate(end)) return null;
  const n = daysBetween(start, end);
  return n == null || n < 0 ? null : n + 1;
}

// Which wizard step owns each field, so a problem found anywhere (the summary
// shortcut, the final save, a batch save) can send the person to the one
// place they can fix it.
export const FIELD_STEP = {
  name: 'name', amount: 'amount', unit: 'amount', times: 'times', days: 'often',
  start_date: 'often', end_date: 'often',
};

/**
 * Validation for a whole medicine draft. Returns a list of { field, message }
 * — never throws. The SAME list gates every way out of the wizard: Continue,
 * "Skip to the summary", "Add to review", the batch save and the final save,
 * so no shortcut can carry an incomplete or unsafe schedule past it. As-needed
 * (PRN) medicines are the one deliberate exception to "needs a time".
 */
export function validateMedicine(med, { amountProblem } = {}) {
  const problems = [];
  if (!String(med.name || '').trim()) {
    problems.push({ field: 'name', message: 'What is this medicine called?' });
  }
  if (amountProblem) {
    const p = amountProblem(med.dose_amount);
    if (p) problems.push({ field: 'amount', message: p });
  }
  if (med.dose_unit === 'other' && !String(med.dose_other || '').trim()) {
    problems.push({ field: 'unit', message: 'What do you call the amount? For example: scoop or spray.' });
  }
  const freq = med.frequency || 'daily';
  const times = normaliseTimes(med.times);

  if (freq !== 'as_needed' && !times.length) {
    problems.push({ field: 'times', message: 'Pick at least one time of day, or choose "Only when needed".' });
  }
  if (freq === 'days_of_week' && !(med.days_of_week || []).length) {
    problems.push({ field: 'days', message: 'Choose at least one day of the week.' });
  }
  if (med.start_date && !isIsoDate(med.start_date)) {
    problems.push({ field: 'start_date', message: 'The start date is not a real date.' });
  }
  if (med.end_date && !isIsoDate(med.end_date)) {
    problems.push({ field: 'end_date', message: 'The stop date is not a real date.' });
  }
  if (isIsoDate(med.start_date) && isIsoDate(med.end_date) && daysBetween(med.start_date, med.end_date) < 0) {
    problems.push({ field: 'end_date', message: 'The stop date is before the start date. Please change one of them.' });
  }
  return problems;
}
