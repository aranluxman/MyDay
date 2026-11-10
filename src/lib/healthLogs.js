// Health tracker rules, kept pure (no React, no Supabase) so they are tested
// directly in test/healthLogs.test.js.
//
// What this module will not do, on purpose:
//   * infer or fill in a missing reading — a day with no entry stays empty;
//   * judge a reading — there are no targets, "normal" ranges or colours for
//     good and bad. The limits below only catch typing mistakes, and match
//     the database's own checks (migration 20261110180000);
//   * convert silently — a weight typed in pounds is stored in kilograms and
//     remembers that it was typed in pounds.

export const LB_PER_KG = 2.2046226218;
export const CM_PER_IN = 2.54;

export const KINDS = [
  { id: 'water', label: 'Water', icon: 'droplet', logLabel: 'Log water' },
  { id: 'sleep', label: 'Sleep', icon: 'moon', logLabel: 'Log sleep' },
  { id: 'weight', label: 'Weight', icon: 'scale', logLabel: 'Log weight' },
  { id: 'blood_pressure', label: 'Blood pressure', icon: 'heartPulse', logLabel: 'Log blood pressure' },
  { id: 'heart_rate', label: 'Heart rate', icon: 'heart', logLabel: 'Log heart rate' },
];
export const KIND_IDS = KINDS.map((k) => k.id);
export const kindInfo = (id) => KINDS.find((k) => k.id === id) || null;

const round1 = (n) => Math.round(n * 10) / 10;
// A number someone typed: "7", "7.5", "7,5". Anything else is not a number.
export function parseNumber(raw) {
  const t = String(raw ?? '').trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
const whole = (n) => n != null && Number.isInteger(n);

export const kgToLb = (kg) => round1(kg * LB_PER_KG);
// Two decimals of a kilogram, so 150 lb reads back as 150 lb, not 149.9.
export const lbToKg = (lb) => Math.round((lb / LB_PER_KG) * 100) / 100;
export function cmToFtIn(cm) {
  const totalIn = Math.round(cm / CM_PER_IN);
  return { ft: Math.floor(totalIn / 12), inches: totalIn % 12 };
}
export const ftInToCm = (ft, inches) => round1((ft * 12 + inches) * CM_PER_IN);

/**
 * Check what was typed for one reading and turn it into a row to save.
 * @returns {{ ok: true, row: object } | { ok: false, errors: Record<string,string> }}
 * `input` fields by kind:
 *   water          { amount, unit: 'glass' | 'ml' }
 *   sleep          { hours, minutes }
 *   weight         { amount, unit: 'kg' | 'lb' }
 *   blood_pressure { systolic, diastolic }
 *   heart_rate     { bpm }
 * plus optional { note, loggedAt (ISO), now (ms, for tests) } on all of them.
 */
export function validateLog(kind, input = {}) {
  const errors = {};
  let row = null;
  const now = input.now ?? Date.now();

  if (kind === 'water') {
    const unit = input.unit === 'ml' ? 'ml' : 'glass';
    const n = parseNumber(input.amount);
    const max = unit === 'glass' ? 40 : 10000;
    if (n == null || n <= 0) errors.amount = unit === 'glass' ? 'Enter how many glasses, for example 1.' : 'Enter the amount in millilitres, for example 250.';
    else if (n > max) errors.amount = unit === 'glass' ? 'That is more than 40 glasses. Please check the number.' : 'That is more than 10,000 ml. Please check the number.';
    else row = { kind, value: round1(n), value2: null, unit };
  } else if (kind === 'sleep') {
    const hRaw = String(input.hours ?? '').trim();
    const mRaw = String(input.minutes ?? '').trim();
    const h = hRaw === '' ? 0 : parseNumber(hRaw);
    const m = mRaw === '' ? 0 : parseNumber(mRaw);
    if (hRaw === '' && mRaw === '') errors.hours = 'Enter how long you slept, for example 7 hours 30 minutes.';
    else if (!whole(h) || h > 24) errors.hours = 'Hours must be a whole number from 0 to 24.';
    else if (!whole(m) || m > 59) errors.minutes = 'Minutes must be a whole number from 0 to 59.';
    else if (h * 60 + m < 1) errors.hours = 'Enter how long you slept, for example 7 hours 30 minutes.';
    else if (h * 60 + m > 1440) errors.hours = 'That is more than 24 hours. Please check the numbers.';
    else row = { kind, value: h * 60 + m, value2: null, unit: 'min' };
  } else if (kind === 'weight') {
    const unit = input.unit === 'lb' ? 'lb' : 'kg';
    const n = parseNumber(input.amount);
    const kg = n == null ? null : unit === 'lb' ? lbToKg(n) : round1(n);
    if (n == null || n <= 0) errors.amount = `Enter your weight in ${unit === 'lb' ? 'pounds' : 'kilograms'}, for example ${unit === 'lb' ? '150' : '68'}.`;
    else if (kg < 20 || kg > 400) errors.amount = unit === 'lb' ? 'Weight must be between 44 and 880 lb. Please check the number.' : 'Weight must be between 20 and 400 kg. Please check the number.';
    else row = { kind, value: kg, value2: null, unit };
  } else if (kind === 'blood_pressure') {
    const sys = parseNumber(input.systolic);
    const dia = parseNumber(input.diastolic);
    if (!whole(sys)) errors.systolic = 'Enter the top number (systolic), for example 120.';
    else if (sys < 50 || sys > 300) errors.systolic = 'The top number must be between 50 and 300. Please check it.';
    if (!whole(dia)) errors.diastolic = 'Enter the bottom number (diastolic), for example 80.';
    else if (dia < 20 || dia > 200) errors.diastolic = 'The bottom number must be between 20 and 200. Please check it.';
    if (!errors.systolic && !errors.diastolic && sys <= dia) errors.diastolic = 'The bottom number should be lower than the top number. Please check both.';
    if (!errors.systolic && !errors.diastolic) row = { kind, value: sys, value2: dia, unit: 'mmHg' };
  } else if (kind === 'heart_rate') {
    const n = parseNumber(input.bpm);
    if (!whole(n)) errors.bpm = 'Enter beats per minute as a whole number, for example 72.';
    else if (n < 20 || n > 250) errors.bpm = 'Heart rate must be between 20 and 250 beats per minute. Please check it.';
    else row = { kind, value: n, value2: null, unit: 'bpm' };
  } else {
    errors.kind = 'Unknown measurement.';
  }

  const note = String(input.note ?? '').trim();
  if (note.length > 500) errors.note = 'Please keep the note under 500 characters.';

  let loggedAt = new Date(now).toISOString();
  if (input.loggedAt) {
    const t = new Date(input.loggedAt).getTime();
    if (!Number.isFinite(t)) errors.loggedAt = 'That date and time does not look right.';
    else if (t > now + 60_000) errors.loggedAt = 'The time cannot be in the future.';
    else loggedAt = new Date(t).toISOString();
  }

  if (Object.keys(errors).length || !row) return { ok: false, errors };
  return { ok: true, row: { ...row, note: note || null, logged_at: loggedAt } };
}

/** "7 h 20 min" */
export function sleepWords(minutes) {
  const m = Math.round(Number(minutes) || 0);
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${rest} min`;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}
const trim = (n) => String(round1(Number(n)));

/** One reading as words with its unit, e.g. "128/82 mmHg", "68.5 kg". */
export function formatLog(row, { weightUnit } = {}) {
  if (!row) return '';
  switch (row.kind) {
    case 'water': return row.unit === 'ml' ? `${trim(row.value)} ml` : `${trim(row.value)} ${Number(row.value) === 1 ? 'glass' : 'glasses'}`;
    case 'sleep': return sleepWords(row.value);
    case 'weight': {
      const unit = weightUnit || row.unit || 'kg';
      return unit === 'lb' ? `${trim(kgToLb(Number(row.value)))} lb` : `${trim(row.value)} kg`;
    }
    case 'blood_pressure': return `${trim(row.value)}/${trim(row.value2)} mmHg`;
    case 'heart_rate': return `${trim(row.value)} bpm`;
    default: return '';
  }
}

/** Newest reading of each kind. `rows` in any order. */
export function latestByKind(rows) {
  const out = {};
  for (const r of rows || []) {
    if (!r || !KIND_IDS.includes(r.kind)) continue;
    if (!out[r.kind] || new Date(r.logged_at) > new Date(out[r.kind].logged_at)) out[r.kind] = r;
  }
  return out;
}

/**
 * Water drunk on one day, as words. Glasses and millilitres are different
 * units and are never added together or converted (a "glass" has no fixed
 * size), so a day with both says both.
 */
export function waterForDay(rows, dayIso, dayOf) {
  let glasses = 0; let ml = 0; let count = 0;
  for (const r of rows || []) {
    if (r?.kind !== 'water' || dayOf(r.logged_at) !== dayIso) continue;
    count += 1;
    if (r.unit === 'ml') ml += Number(r.value); else glasses += Number(r.value);
  }
  if (!count) return null;
  const parts = [];
  if (glasses) parts.push(`${trim(glasses)} ${glasses === 1 ? 'glass' : 'glasses'}`);
  if (ml) parts.push(`${trim(ml)} ml`);
  return { text: parts.join(' + '), glasses: round1(glasses), ml: round1(ml), count };
}

/**
 * One point per day for a chart of the last `days` days ending at `endIso`.
 * A day without a reading has value null — never zero, never carried over.
 *   water: the day's total in `unit` ('glass' unless told otherwise); other
 *   unit's entries are left out of the chart and counted in `otherUnit`.
 *   sleep: total minutes logged that day.
 *   others: the day's last reading (blood pressure keeps both numbers).
 */
export function dailySeries(rows, kind, { endIso, days = 7, dayOf, unit } = {}) {
  const list = [];
  const end = new Date(`${endIso}T12:00:00`);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end); d.setDate(d.getDate() - i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    list.push({ day: iso, value: null, value2: null, count: 0 });
  }
  const byDay = new Map(list.map((p) => [p.day, p]));
  let otherUnit = 0;
  const sorted = [...(rows || [])].filter((r) => r?.kind === kind).sort((a, b) => new Date(a.logged_at) - new Date(b.logged_at));
  for (const r of sorted) {
    const p = byDay.get(dayOf(r.logged_at));
    if (!p) continue;
    if (kind === 'water') {
      const want = unit || 'glass';
      if (r.unit !== want) { otherUnit += 1; continue; }
      p.value = round1((p.value || 0) + Number(r.value));
    } else if (kind === 'sleep') {
      p.value = (p.value || 0) + Number(r.value);
    } else {
      p.value = Number(r.value);
      p.value2 = r.value2 == null ? null : Number(r.value2);
    }
    p.count += 1;
  }
  return { points: list, otherUnit, daysWithData: list.filter((p) => p.value != null).length };
}

/** Plain average of the days that have a reading; null when none do. */
export function averageOf(points) {
  const vals = (points || []).map((p) => p.value).filter((v) => v != null);
  if (!vals.length) return null;
  return round1(vals.reduce((a, b) => a + b, 0) / vals.length);
}

// ---------- health profile ----------
export const GENDERS = [
  { value: 'woman', label: 'Woman' },
  { value: 'man', label: 'Man' },
  { value: 'non_binary', label: 'Non-binary' },
  { value: 'other', label: 'Another answer' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];
export const genderLabel = (v) => GENDERS.find((g) => g.value === v)?.label || null;

/** Height as words in the person's unit, or null when not entered. */
export function heightWords(cm, unit = 'cm') {
  if (cm == null || cm === '') return null;
  if (unit === 'ft_in') { const { ft, inches } = cmToFtIn(Number(cm)); return `${ft} ft ${inches} in`; }
  return `${trim(cm)} cm`;
}
export function weightWords(kg, unit = 'kg') {
  if (kg == null || kg === '') return null;
  return unit === 'lb' ? `${trim(kgToLb(Number(kg)))} lb` : `${trim(kg)} kg`;
}

/**
 * Allergies have three honest states: a list, "No known allergies" (a real
 * answer), and "Not entered" (no answer yet). They are never merged.
 */
export function allergyState(profile) {
  const text = String(profile?.allergies ?? '').trim();
  if (text) return { state: 'listed', text };
  if (profile?.allergies_none) return { state: 'none', text: 'No known allergies' };
  return { state: 'missing', text: 'Not entered' };
}

/** Check the height/weight fields of the profile editor. */
export function validateBody({ heightUnit, heightCm, heightFt, heightIn, weightUnit, weight }) {
  const errors = {};
  const out = { height_cm: null, weight_kg: null };
  if (heightUnit === 'ft_in') {
    const fRaw = String(heightFt ?? '').trim(); const iRaw = String(heightIn ?? '').trim();
    if (fRaw !== '' || iRaw !== '') {
      const ft = fRaw === '' ? 0 : parseNumber(fRaw); const inches = iRaw === '' ? 0 : parseNumber(iRaw);
      if (!whole(ft) || !whole(inches) || inches > 11) errors.height = 'Enter feet and inches as whole numbers, for example 5 ft 6 in.';
      else {
        const cm = ftInToCm(ft, inches);
        if (cm < 50 || cm > 260) errors.height = 'Height must be between 1 ft 8 in and 8 ft 6 in. Please check it.';
        else out.height_cm = cm;
      }
    }
  } else if (String(heightCm ?? '').trim() !== '') {
    const cm = parseNumber(heightCm);
    if (cm == null || cm < 50 || cm > 260) errors.height = 'Height must be between 50 and 260 cm. Please check it.';
    else out.height_cm = round1(cm);
  }
  if (String(weight ?? '').trim() !== '') {
    const n = parseNumber(weight);
    const kg = n == null ? null : weightUnit === 'lb' ? lbToKg(n) : round1(n);
    if (kg == null || kg < 20 || kg > 400) errors.weight = weightUnit === 'lb' ? 'Weight must be between 44 and 880 lb. Please check it.' : 'Weight must be between 20 and 400 kg. Please check it.';
    else out.weight_kg = kg;
  }
  return { ok: !Object.keys(errors).length, errors, values: out };
}
