import { buildDoseString } from './doseUnits.js';
import { normaliseTimes, validateMedicine } from './schedule.js';

// Keep the wizard and the batch insert on the same validation and field rules.
export function toMedicationPayload(form) {
  const problem = validateMedicine(form)[0];
  if (problem) throw new Error(problem.message);
  return {
    name: form.name.trim(),
    dose: buildDoseString(form.dose_amount, form.dose_unit, form.dose_other),
    dose_amount: form.dose_amount,
    dose_unit: form.dose_unit,
    dose_other: form.dose_unit === 'other' ? (form.dose_other || '').trim() : null,
    times: normaliseTimes(form.times),
    frequency: form.frequency,
    days_of_week: form.days_of_week,
    start_date: form.start_date || null,
    end_date: form.end_date || null,
    with_food: form.with_food,
    note: (form.note || '').trim(),
    color: form.color,
    photo_path: form.photo_path,
  };
}
