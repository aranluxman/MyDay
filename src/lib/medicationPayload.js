import { buildDoseString, amountProblem, amountValue, cleanStrength, ROUTE_IDS } from './doseUnits.js';
import { normaliseTimes, validateMedicine } from './schedule.js';

// Every problem with a medicine draft, including the dose amount. The wizard,
// the batch review and the final insert all call this one function, so no
// path can save something another path would have refused.
export function medicineProblems(form) {
  return validateMedicine(form, { amountProblem });
}

const optionalNumber = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

// Keep the wizard and the batch insert on the same validation and field rules.
// Throws (with the first problem's message) rather than saving anything the
// person did not see on the review screen.
export function toMedicationPayload(form) {
  const problem = medicineProblems(form)[0];
  if (problem) throw new Error(problem.message);
  const amount = amountValue(form.dose_amount);
  return {
    name: form.name.trim(),
    // Built from the exact amount: 2.75 stays 2.75 in the text column too.
    dose: buildDoseString(amount, form.dose_unit, form.dose_other),
    dose_amount: amount,
    dose_unit: form.dose_unit,
    dose_other: form.dose_unit === 'other' ? (form.dose_other || '').trim() : null,
    strength: cleanStrength(form.strength) || null,
    route: ROUTE_IDS.includes(form.route) ? form.route : null,
    instructions: String(form.instructions || '').trim().slice(0, 200) || null,
    times: normaliseTimes(form.times),
    frequency: form.frequency,
    days_of_week: form.days_of_week,
    start_date: form.start_date || null,
    end_date: form.end_date || null,
    with_food: form.with_food,
    note: (form.note || '').trim(),
    color: form.color,
    photo_path: form.photo_path,
    stock_quantity: optionalNumber(form.stock_quantity),
    refill_threshold: optionalNumber(form.refill_threshold),
    pharmacy_contact_id: form.pharmacy_contact_id || null,
    prescriber_contact_id: form.prescriber_contact_id || null,
  };
}
