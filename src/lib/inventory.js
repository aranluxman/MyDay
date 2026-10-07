// Supply on hand, as an ESTIMATE.
//
// Stock is only ever changed by the server when a dose is confirmed taken
// (and put back on undo) — never for a missed or skipped dose — so these
// functions only read it. "Days left" assumes the schedule is followed and is
// always presented as "about", because it is a projection, not a count.
import { amountValue } from './doseUnits.js';
import { normaliseTimes } from './schedule.js';

/** Average doses per day the schedule calls for, or null when unscheduled. */
export function dosesPerDay(med) {
  const times = normaliseTimes(med?.times).length;
  const freq = med?.frequency || 'daily';
  if (freq === 'as_needed' || !times) return null;
  if (freq === 'alternate') return times / 2;
  if (freq === 'days_of_week') {
    const days = (med.days_of_week || []).length;
    return days ? (times * days) / 7 : null;
  }
  return times;
}

/**
 * { left, perDay, daysLeft, low, unknown } for a medicine.
 * `unknown` when no stock is recorded — logging still works; we simply do
 * not guess. `daysLeft` is null for as-needed medicines.
 */
export function supplyEstimate(med) {
  const left = med?.stock_quantity == null || med.stock_quantity === '' ? null : Number(med.stock_quantity);
  if (left == null || !Number.isFinite(left)) return { unknown: true, left: null, daysLeft: null, low: false };
  const amount = amountValue(typeof med.dose_amount === 'string' ? med.dose_amount : Number(med.dose_amount));
  const perDay = dosesPerDay(med);
  const use = amount && perDay ? amount * perDay : null;
  const daysLeft = use ? Math.floor(left / use) : null;
  const threshold = med.refill_threshold == null || med.refill_threshold === '' ? null : Number(med.refill_threshold);
  const low = (threshold != null && left <= threshold) || left <= 0;
  return { unknown: false, left, perDay: use, daysLeft, low };
}

/** "About 12 days left" / "Running low: 3 left" / null. Plain words, never a promise. */
export function supplyWords(med, unitWord = 'left') {
  const s = supplyEstimate(med);
  if (s.unknown) return null;
  const left = Number(s.left.toFixed(4));
  if (left <= 0) return 'None left — time to refill';
  const base = `${left} ${unitWord}`;
  if (s.low) return `Running low: ${base}`;
  if (s.daysLeft != null) return `${base} · about ${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'} (estimate)`;
  return base;
}
