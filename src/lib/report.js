// What a report says, worked out in one tested place (test/report.test.js) so
// the preview on screen and the printed page can never disagree.
//
// Honesty rules:
//   * Medication totals count only scheduled doses whose time has passed and
//     that are settled: recorded as taken, marked "Not today", or not
//     recorded after their window. Doses still open (today's later doses) and
//     as-needed doses are listed separately and never in the denominator.
//   * "Not recorded" means MyDay has no record. It does not mean not taken.
//   * A day or a measurement with no entry is reported as no entry. Nothing
//     is estimated, carried forward or averaged over missing days.
import { doseState } from './doseState.js';
import { KINDS, formatLog, sleepWords } from './healthLogs.js';

export const RANGES = [
  { id: '7', label: 'Last 7 days', days: 7 },
  { id: '30', label: 'Last 30 days', days: 30 },
  { id: '90', label: 'Last 90 days', days: 90 },
];

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The [from, to] dates (inclusive) of a range that ends on `endIso`. */
export function rangeDates(days, endIso) {
  const end = new Date(`${endIso}T12:00:00`);
  const start = new Date(end); start.setDate(start.getDate() - (days - 1));
  return { from: isoOf(start), to: endIso };
}
export function daysBetween(fromIso, toIso) {
  const out = [];
  const d = new Date(`${fromIso}T12:00:00`);
  const end = new Date(`${toIso}T12:00:00`);
  while (d <= end && out.length < 400) { out.push(isoOf(d)); d.setDate(d.getDate() + 1); }
  return out;
}

/**
 * @param {object} p
 * @param {object[]} p.doses   rows from doseHistory(from, to)
 * @param {object[]} p.logs    health log rows
 * @param {object[]} p.diary   diary rows
 * @param {string} p.from, p.to  inclusive ISO dates
 * @param {(iso: string) => string} p.dayOf  timestamp -> local ISO date
 * @param {{now?: number, windowMinutes?: number}} [p.opts]
 */
export function buildReport({ doses = [], logs = [], diary = [], from, to, dayOf, opts = {} }) {
  const days = daysBetween(from, to);
  const inRange = (iso) => iso >= from && iso <= to;

  // ---- medicines ----
  const perDay = new Map(days.map((d) => [d, { day: d, taken: 0, skipped: 0, notRecorded: 0, open: 0 }]));
  const perMed = new Map();
  const totals = { scheduled: 0, taken: 0, skipped: 0, notRecorded: 0, open: 0, asNeeded: 0 };
  for (const d of doses) {
    if (!d || !inRange(d.dose_date)) continue;
    const name = d.name_snapshot || d.medication?.name || 'Medicine';
    const med = perMed.get(name) || { name, scheduled: 0, taken: 0, skipped: 0, notRecorded: 0, asNeeded: 0 };
    perMed.set(name, med);
    if (d.as_needed) {
      if (d.status === 'taken') { totals.asNeeded += 1; med.asNeeded += 1; }
      continue;
    }
    const st = doseState(d, opts);
    const day = perDay.get(d.dose_date);
    if (st === 'taken') { totals.taken += 1; med.taken += 1; day.taken += 1; }
    else if (st === 'skipped') { totals.skipped += 1; med.skipped += 1; day.skipped += 1; }
    else if (st === 'missed') { totals.notRecorded += 1; med.notRecorded += 1; day.notRecorded += 1; }
    else { totals.open += 1; day.open += 1; continue; }
    totals.scheduled += 1; med.scheduled += 1;
  }
  const medicines = {
    ...totals,
    perDay: [...perDay.values()],
    perMedicine: [...perMed.values()].sort((a, b) => a.name.localeCompare(b.name)),
    daysWithSchedule: [...perDay.values()].filter((d) => d.taken + d.skipped + d.notRecorded + d.open > 0).length,
  };

  // ---- health logs ----
  const health = KINDS.map((k) => {
    const rows = logs.filter((r) => r?.kind === k.id && inRange(dayOf(r.logged_at)))
      .sort((a, b) => new Date(b.logged_at) - new Date(a.logged_at));
    const loggedDays = new Set(rows.map((r) => dayOf(r.logged_at)));
    const out = { kind: k.id, label: k.label, count: rows.length, daysLogged: loggedDays.size, totalDays: days.length, latest: rows[0] || null, rows, summary: null };
    if (!rows.length) return out;
    if (k.id === 'sleep') {
      // Average over the days that HAVE an entry, and say so.
      const byDay = new Map();
      for (const r of rows) byDay.set(dayOf(r.logged_at), (byDay.get(dayOf(r.logged_at)) || 0) + Number(r.value));
      const avg = [...byDay.values()].reduce((a, b) => a + b, 0) / byDay.size;
      out.summary = `Average ${sleepWords(avg)} on the ${byDay.size} day${byDay.size === 1 ? '' : 's'} logged`;
    } else if (k.id === 'water') {
      const glasses = rows.filter((r) => r.unit === 'glass').reduce((a, r) => a + Number(r.value), 0);
      const ml = rows.filter((r) => r.unit === 'ml').reduce((a, r) => a + Number(r.value), 0);
      const parts = [];
      if (glasses) parts.push(`${Math.round(glasses * 10) / 10} ${glasses === 1 ? 'glass' : 'glasses'}`);
      if (ml) parts.push(`${Math.round(ml)} ml`);
      out.summary = `${parts.join(' + ')} logged in total`;
    } else if (k.id === 'blood_pressure') {
      const sys = rows.map((r) => Number(r.value)); const dia = rows.map((r) => Number(r.value2));
      out.summary = rows.length > 1 ? `Readings from ${Math.min(...sys)}/${Math.min(...dia)} to ${Math.max(...sys)}/${Math.max(...dia)} mmHg` : `One reading: ${formatLog(rows[0])}`;
    } else {
      const vals = rows.map((r) => Number(r.value));
      const unit = k.id === 'weight' ? 'kg' : 'bpm';
      out.summary = rows.length > 1 ? `Readings from ${Math.min(...vals)} to ${Math.max(...vals)} ${unit}` : `One reading: ${formatLog(rows[0], { weightUnit: 'kg' })}`;
    }
    return out;
  });

  // ---- diary ----
  const notes = diary.filter((e) => e?.entry_at && inRange(dayOf(e.entry_at)))
    .sort((a, b) => new Date(b.entry_at) - new Date(a.entry_at));

  return { from, to, days: days.length, medicines, health, notes };
}

/** The headline sentence for medicines, with its denominator spelled out. */
export function medicineHeadline(m) {
  if (!m.scheduled) return m.open ? 'No scheduled doses have finished in this period yet.' : 'No scheduled doses in this period.';
  return `${m.taken} of ${m.scheduled} scheduled doses recorded as taken`;
}
