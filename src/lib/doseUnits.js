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

/** Units offered as large chips, in the order they are shown. */
export const UNITS = [
  { id: 'tablet', label: 'tablet', plural: 'tablets', countable: true },
  { id: 'capsule', label: 'capsule', plural: 'capsules', countable: true },
  { id: 'ml', label: 'ml', plural: 'ml', countable: false },
  { id: 'drop', label: 'drop', plural: 'drops', countable: true },
  { id: 'puff', label: 'puff', plural: 'puffs', countable: true },
  { id: 'mg', label: 'mg', plural: 'mg', countable: false },
  { id: 'IU', label: 'IU', plural: 'IU', countable: false },
  { id: 'unit', label: 'unit', plural: 'units', countable: true },
  { id: 'patch', label: 'patch', plural: 'patches', countable: true },
  { id: 'sachet', label: 'sachet', plural: 'sachets', countable: true },
  { id: 'injection', label: 'injection', plural: 'injections', countable: true },
  { id: 'other', label: 'other', plural: 'other', countable: true },
];

export const UNIT_IDS = UNITS.map((u) => u.id);
const UNIT_BY_ID = Object.fromEntries(UNITS.map((u) => [u.id, u]));

/** Halves are allowed because half a tablet is a real prescription. */
export const STEP = 0.5;
export const MIN_AMOUNT = 0.5;
export const MAX_AMOUNT = 9999;

// What people actually type, mapped to a unit. Longest first so 'tablets'
// is not eaten by 'tab'.
const SYNONYMS = [
  ['tablets', 'tablet'], ['tablet', 'tablet'], ['tabs', 'tablet'], ['tab', 'tablet'], ['tbl', 'tablet'],
  ['pills', 'tablet'], ['pill', 'tablet'],
  ['capsules', 'capsule'], ['capsule', 'capsule'], ['caps', 'capsule'], ['cap', 'capsule'],
  ['millilitres', 'ml'], ['milliliters', 'ml'], ['ml', 'ml'], ['mls', 'ml'],
  ['teaspoons', 'ml'], ['teaspoon', 'ml'], ['tsp', 'ml'],
  ['drops', 'drop'], ['drop', 'drop'], ['gtt', 'drop'],
  ['puffs', 'puff'], ['puff', 'puff'], ['inhalations', 'puff'], ['inhalation', 'puff'],
  ['milligrams', 'mg'], ['milligram', 'mg'], ['mgs', 'mg'], ['mg', 'mg'],
  ['micrograms', 'mcg'], ['mcg', 'mcg'], ['µg', 'mcg'],
  ['grams', 'g'], ['gram', 'g'],
  ['iu', 'IU'], ['units', 'unit'], ['unit', 'unit'], ['u', 'unit'],
  ['patches', 'patch'], ['patch', 'patch'],
  ['sachets', 'sachet'], ['sachet', 'sachet'], ['packets', 'sachet'], ['packet', 'sachet'],
  ['injections', 'injection'], ['injection', 'injection'], ['shots', 'injection'], ['shot', 'injection'],
];

// mcg and g are understood when parsing old data but are not offered as chips
// (they would make the picker longer for very few real prescriptions). They
// round-trip as 'other' with the original text preserved.
const PARSE_ONLY_UNITS = { mcg: 'mcg', g: 'g' };

/** Clamp to the allowed range and snap to the nearest half. */
export function clampAmount(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 1;
  const snapped = Math.round(v / STEP) * STEP;
  return Math.min(MAX_AMOUNT, Math.max(MIN_AMOUNT, snapped));
}

/** 0.5 -> "1/2", 1 -> "1", 1.5 -> "1 1/2", 1000 -> "1000". */
export function formatAmount(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  // Only whole-and-a-half values get a fraction; 2.25 has no nice form.
  const whole = Math.floor(v);
  const frac = +(v - whole).toFixed(2);
  if (frac !== 0.5) return String(+v.toFixed(2));
  return whole === 0 ? '1/2' : `${whole} 1/2`;
}

/**
 * The string stored in myday_medications.dose and shown everywhere.
 * "1 tablet", "2 tablets", "1/2 tablet", "1000 IU", "5 ml".
 */
export function buildDoseString(amount, unit, otherText = '') {
  const a = clampAmount(amount);
  const amountStr = formatAmount(a);

  if (unit === 'other') {
    const t = String(otherText || '').trim();
    return t ? `${amountStr} ${t}` : amountStr;
  }
  const def = UNIT_BY_ID[unit];
  if (!def) {
    // A parse-only unit (mcg, g) keeps its own spelling.
    const raw = PARSE_ONLY_UNITS[unit];
    return raw ? `${amountStr} ${raw}` : amountStr;
  }
  // Countable units pluralise; mg / ml / IU never do ("2 mgs" is wrong).
  const word = def.countable && a !== 1 && a !== 0.5 ? def.plural : def.label;
  return `${amountStr} ${word}`;
}

/**
 * Recovers { amount, unit, otherText } from a stored dose string.
 *
 * Used to migrate the free-text doses already in the database. Anything that
 * cannot be read is returned with parsed:false and the original text intact —
 * a medicine saved as "dafs" must never be silently turned into "1 tablet",
 * because guessing someone's dose is far worse than admitting we cannot read it.
 */
export function parseDose(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { parsed: false, amount: null, unit: null, otherText: '', raw };

  const text = raw.toLowerCase().replace(/\s+/g, ' ');

  // Leading amount: "1", "0.5", "1/2", "1 1/2", ".5", or "1,5" (comma decimal).
  const m = text.match(/^(\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d*[.,]\d+|\d+)\s*(.*)$/);
  if (!m) return { parsed: false, amount: null, unit: null, otherText: '', raw };

  const amount = parseAmountToken(m[1]);
  if (amount == null) return { parsed: false, amount: null, unit: null, otherText: '', raw };

  const rest = m[2].trim();
  if (!rest) {
    // "2" with no unit: the number is real, the unit is not known.
    return { parsed: true, amount: clampAmount(amount), unit: null, otherText: '', raw };
  }

  // Strip a trailing note that is not part of the dose ("1 tablet at night").
  const head = rest.replace(/[.,;]+$/, '');
  for (const [needle, unit] of SYNONYMS) {
    // Match the unit word at the start of the remainder, whole-word.
    if (head === needle || head.startsWith(`${needle} `)) {
      const tail = head.slice(needle.length).trim();
      const known = UNIT_BY_ID[unit];
      return {
        parsed: true,
        amount: clampAmount(amount),
        unit: known ? unit : 'other',
        otherText: known ? '' : (PARSE_ONLY_UNITS[unit] || ''),
        trailing: tail,
        raw,
      };
    }
  }

  // A number and something we do not recognise as a unit: keep both, and let
  // the person confirm it as "other" rather than inventing a unit for them.
  return { parsed: true, amount: clampAmount(amount), unit: 'other', otherText: head, raw };
}

function parseAmountToken(tok) {
  const t = String(tok).trim().replace(',', '.');
  // "1 1/2"
  const mixed = t.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const d = Number(mixed[3]);
    if (!d) return null;
    return Number(mixed[1]) + Number(mixed[2]) / d;
  }
  // "1/2"
  const frac = t.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) {
    const d = Number(frac[2]);
    if (!d) return null;
    return Number(frac[1]) / d;
  }
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
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
