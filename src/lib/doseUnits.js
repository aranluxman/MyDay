// Structured doses.
//
// The dose used to be a free-text box, which is how a medicine ends up saved
// as "dafs". A dose is really two things — an amount and a unit — so this
// module owns that pair, the string built from it for display, and the parser
// that recovers the pair from whatever free text is already stored.
//
// The stored column stays a text string ("1 tablet", "1000 IU") so every
// existing display, the guardian dashboard and the push notifications keep
// working untouched. The structured columns sit alongside it.
//
// THE ONE RULE: an amount is never changed on the person's behalf. An earlier
// version snapped every amount to the nearest half and floored it at 1/2, so
// 2.75 mg was saved as 3 mg, 0.1 mL as 1/2 mL, and -1 mL as 1/2 mL. A value we
// cannot store exactly is refused with a message, never "corrected".

/** Units offered as large chips, in the order they are shown. */
export const UNITS = [
  { id: 'tablet', label: 'tablet', plural: 'tablets', countable: true },
  { id: 'capsule', label: 'capsule', plural: 'capsules', countable: true },
  { id: 'ml', label: 'mL', plural: 'mL', countable: false },
  { id: 'drop', label: 'drop', plural: 'drops', countable: true },
  { id: 'puff', label: 'puff', plural: 'puffs', countable: true },
  { id: 'mg', label: 'mg', plural: 'mg', countable: false },
  { id: 'mcg', label: 'mcg', plural: 'mcg', countable: false },
  { id: 'IU', label: 'IU', plural: 'IU', countable: false },
  { id: 'unit', label: 'unit', plural: 'units', countable: true },
  { id: 'patch', label: 'patch', plural: 'patches', countable: true },
  { id: 'sachet', label: 'sachet', plural: 'sachets', countable: true },
  { id: 'injection', label: 'injection', plural: 'injections', countable: true },
  { id: 'other', label: 'other', plural: 'other', countable: true },
];

export const UNIT_IDS = UNITS.map((u) => u.id);
const UNIT_BY_ID = Object.fromEntries(UNITS.map((u) => [u.id, u]));

/** Measured units are typed as decimals; countable ones also get +/- buttons. */
export const isCountable = (unit) => UNIT_BY_ID[unit]?.countable !== false;

/** The +/- buttons move by a half: half a tablet is a real prescription. */
export const STEP = 0.5;
export const MAX_AMOUNT = 9999;
// myday_medications.dose_amount is numeric(12,4) from migration 0017. More
// precision than that cannot be stored exactly, so it is refused.
export const MAX_DECIMALS = 4;

// What people actually type, mapped to a unit. Longest first so 'tablets'
// is not eaten by 'tab'.
const SYNONYMS = [
  ['tablets', 'tablet'], ['tablet', 'tablet'], ['tabs', 'tablet'], ['tab', 'tablet'], ['tbl', 'tablet'],
  ['pills', 'tablet'], ['pill', 'tablet'],
  ['capsules', 'capsule'], ['capsule', 'capsule'], ['caps', 'capsule'], ['cap', 'capsule'],
  ['millilitres', 'ml'], ['milliliters', 'ml'], ['ml', 'ml'], ['mls', 'ml'],
  // A teaspoon is NOT silently turned into mL: 5 tsp would become "5 mL",
  // a fifth of the dose. It is kept as its own word instead (see below).
  ['drops', 'drop'], ['drop', 'drop'], ['gtt', 'drop'],
  ['puffs', 'puff'], ['puff', 'puff'], ['inhalations', 'puff'], ['inhalation', 'puff'],
  ['milligrams', 'mg'], ['milligram', 'mg'], ['mgs', 'mg'], ['mg', 'mg'],
  ['micrograms', 'mcg'], ['microgram', 'mcg'], ['mcg', 'mcg'], ['µg', 'mcg'], ['ug', 'mcg'],
  ['grams', 'g'], ['gram', 'g'],
  ['iu', 'IU'], ['units', 'unit'], ['unit', 'unit'], ['u', 'unit'],
  ['patches', 'patch'], ['patch', 'patch'],
  ['sachets', 'sachet'], ['sachet', 'sachet'], ['packets', 'sachet'], ['packet', 'sachet'],
  ['injections', 'injection'], ['injection', 'injection'], ['shots', 'injection'], ['shot', 'injection'],
];

// Understood when parsing old data but not offered as chips. They round-trip
// as 'other' with the original word preserved, never converted.
const PARSE_ONLY_UNITS = { g: 'g' };

/** Number of digits after the decimal point, ignoring float noise. */
function decimalsOf(n) {
  const s = String(n);
  if (/e/i.test(s)) return Infinity;
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

/**
 * Is this a dose amount we can store exactly? Returns null when it is, or a
 * plain-language problem when it is not. Never adjusts the value.
 */
export function amountProblem(value) {
  if (value === '' || value == null) return 'Enter how much you take each time.';
  // Text straight from the amount box: read it exactly as typed.
  if (typeof value === 'string') { const r = parseAmountInput(value); return r.ok ? null : r.error; }
  const n = value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'Enter a number, like 2.5 or 1/2.';
  if (n <= 0) return 'The amount must be more than zero.';
  if (n > MAX_AMOUNT) return `That is more than ${MAX_AMOUNT}. Please check the label.`;
  if (decimalsOf(n) > MAX_DECIMALS) return `Use no more than ${MAX_DECIMALS} decimal places.`;
  return null;
}

/** True when `value` is a storable dose amount (see amountProblem). */
export const isValidAmount = (value) => amountProblem(value) == null;

/** The exact number for a valid amount (typed text or a number), else null. */
export function amountValue(value) {
  if (typeof value === 'number') return isValidAmount(value) ? value : null;
  const r = parseAmountInput(value);
  return r.ok ? r.value : null;
}

/**
 * Reads what was typed into the amount box. Accepts "2.75", "0,1" (comma
 * decimal), ".5", "1/2" and "1 1/2". Returns { ok, value } or { ok:false,
 * error } — "-1", "0", "abc", "1e3", "1.2.3", "" and "Infinity" are refused.
 * The value is exact: a fraction that would need rounding is refused too.
 */
export function parseAmountInput(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { ok: false, error: 'Enter how much you take each time.' };
  if (/^-/.test(text)) return { ok: false, error: 'The amount must be more than zero.' };

  let value = null;
  const mixed = text.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  const frac = text.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const d = Number(mixed[3]);
    if (!d) return { ok: false, error: 'Enter a number, like 2.5 or 1/2.' };
    value = Number(mixed[1]) + Number(mixed[2]) / d;
  } else if (frac) {
    const d = Number(frac[2]);
    if (!d) return { ok: false, error: 'Enter a number, like 2.5 or 1/2.' };
    value = Number(frac[1]) / d;
  } else if (/^\d*[.,]?\d+$/.test(text)) {
    value = Number(text.replace(',', '.'));
  } else {
    return { ok: false, error: 'Enter a number, like 2.5 or 1/2.' };
  }
  // A fraction like 1/3 has no exact decimal form; rounding it would change
  // the prescription, so it is refused rather than stored as 0.3333.
  if ((mixed || frac) && decimalsOf(value) > MAX_DECIMALS) {
    return { ok: false, error: 'That fraction cannot be stored exactly. Please type it as a decimal from the label.' };
  }
  const problem = amountProblem(value);
  return problem ? { ok: false, error: problem } : { ok: true, value };
}

/**
 * The +/- buttons. Moves by STEP, never below a positive amount and never
 * snapping the existing value: 2.75 + 0.5 is 3.25, not 3.5.
 */
export function stepAmount(current, delta) {
  const cur = Number(current);
  const base = Number.isFinite(cur) && cur > 0 ? cur : 0;
  const next = Math.round((base + delta) * 10000) / 10000;
  if (next <= 0) return Number.isFinite(cur) && cur > 0 ? cur : STEP;
  return Math.min(MAX_AMOUNT, next);
}

/** Exact decimal string with a leading zero and no trailing zeros: 0.1, 2.75. */
export function decimalString(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return String(Number(v.toFixed(MAX_DECIMALS)));
}

const FRACTIONS = { 0.25: '1/4', 0.5: '1/2', 0.75: '3/4' };

/**
 * How an amount is written. Countable things read as fractions where that is
 * natural ("1/2 tablet", "1 1/2 tablets"); measured amounts are always
 * decimals ("0.5 mL", "2.75 mg"), because "1/2 mL" next to a syringe
 * marked in decimals is an invitation to misread it.
 */
export function formatAmount(n, unit = 'tablet') {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  if (isCountable(unit)) {
    const whole = Math.floor(v);
    const frac = Number((v - whole).toFixed(MAX_DECIMALS));
    if (FRACTIONS[frac]) return whole === 0 ? FRACTIONS[frac] : `${whole} ${FRACTIONS[frac]}`;
  }
  return decimalString(v);
}

/**
 * The string stored in myday_medications.dose and shown everywhere.
 * "1 tablet", "2 tablets", "1/2 tablet", "1000 IU", "2.75 mg", "0.1 mL".
 * Returns '' when the amount is not valid: callers validate first, and an
 * empty string can never be mistaken for a dose.
 */
export function buildDoseString(amount, unit, otherText = '') {
  const a = amountValue(amount);
  if (a == null) return '';
  const amountStr = formatAmount(a, unit);

  if (unit === 'other') {
    const t = String(otherText || '').trim();
    return t ? `${amountStr} ${t}` : amountStr;
  }
  const def = UNIT_BY_ID[unit];
  if (!def) {
    const raw = PARSE_ONLY_UNITS[unit];
    return raw ? `${amountStr} ${raw}` : amountStr;
  }
  // Countable units pluralise above one; mg / mL / IU never do ("2 mgs").
  const word = def.countable && a > 1 ? def.plural : def.label;
  return `${amountStr} ${word}`;
}

/**
 * Recovers { amount, unit, otherText } from a stored dose string.
 *
 * Used to migrate the free-text doses already in the database. Anything that
 * cannot be read is returned with parsed:false and the original text intact —
 * a medicine saved as "dafs" must never be silently turned into "1 tablet",
 * because guessing someone's dose is far worse than admitting we cannot read it.
 * The amount is returned exactly as written, never rounded or floored.
 */
export function parseDose(input) {
  const raw = String(input ?? '').trim();
  const fail = { parsed: false, amount: null, unit: null, otherText: '', raw };
  if (!raw) return fail;

  const text = raw.toLowerCase().replace(/\s+/g, ' ');

  // Leading amount: "1", "0.5", "1/2", "1 1/2", ".5", or "1,5" (comma decimal).
  const m = text.match(/^(\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d*[.,]\d+|\d+)\s*(.*)$/);
  if (!m) return fail;

  const read = parseAmountInput(m[1]);
  if (!read.ok) return fail;
  const amount = read.value;

  const rest = m[2].trim();
  if (!rest) {
    // "2" with no unit: the number is real, the unit is not known.
    return { parsed: true, amount, unit: null, otherText: '', raw };
  }

  const head = rest.replace(/[.,;]+$/, '');
  for (const [needle, unit] of SYNONYMS) {
    if (head === needle || head.startsWith(`${needle} `)) {
      const tail = head.slice(needle.length).trim();
      const known = UNIT_BY_ID[unit];
      return {
        parsed: true,
        amount,
        unit: known ? unit : 'other',
        otherText: known ? '' : (PARSE_ONLY_UNITS[unit] || ''),
        trailing: tail,
        raw,
      };
    }
  }

  // A number and something we do not recognise as a unit: keep both, and let
  // the person confirm it as "other" rather than inventing a unit for them.
  return { parsed: true, amount, unit: 'other', otherText: head, raw };
}

/**
 * Migrates a stored dose into structured fields.
 * Returns null when the text cannot be read, so the caller leaves it as-is.
 */
export function migrateDose(stored) {
  const p = parseDose(stored);
  if (!p.parsed) return null;
  return {
    dose_amount: p.amount,
    dose_unit: p.unit,
    dose_other: p.otherText || null,
    // What the string would become if rebuilt. Only used to show the person
    // what changed; the original is kept unless they confirm.
    rebuilt: p.unit ? buildDoseString(p.amount, p.unit, p.otherText) : String(stored).trim(),
  };
}

/** Plain-language summary for the review step. */
export function describeDose(amount, unit, otherText) {
  return buildDoseString(amount, unit, otherText);
}

// ---------------------------------------------------------------------------
// Strength versus amount.
//
// "One 5 mg tablet" and "5 mg" are different prescriptions that read alike.
// The amount above is what is taken each time; the strength is what is
// printed on the box, kept exactly as written. Nothing is ever calculated
// from it: the app does not infer a concentration or convert one into the
// other, because getting that wrong is a tenfold dosing error.
// ---------------------------------------------------------------------------

export const ROUTES = [
  { id: 'oral', label: 'By mouth' },
  { id: 'sublingual', label: 'Under the tongue' },
  { id: 'inhaled', label: 'Breathed in' },
  { id: 'eye', label: 'In the eye' },
  { id: 'ear', label: 'In the ear' },
  { id: 'nose', label: 'In the nose' },
  { id: 'skin', label: 'On the skin' },
  { id: 'injection', label: 'Injection' },
  { id: 'rectal', label: 'Rectal' },
  { id: 'other', label: 'Other' },
];
export const ROUTE_IDS = ROUTES.map((r) => r.id);

/** "250 mg / 5 mL" stays exactly that; only trimmed and length-limited. */
export function cleanStrength(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

/**
 * "1 tablet (5 mg tablet)" — the amount first, the label strength after it in
 * brackets, so the two can never be read as one number.
 */
export function describeDoseWithStrength(med) {
  const dose = med?.dose || buildDoseString(med?.dose_amount, med?.dose_unit, med?.dose_other);
  const strength = cleanStrength(med?.strength);
  if (!strength) return dose;
  const u = UNIT_BY_ID[med?.dose_unit];
  const form = u && u.countable && med.dose_unit !== 'other' ? ` ${u.label}` : '';
  return `${dose} (${strength}${form} strength)`;
}
