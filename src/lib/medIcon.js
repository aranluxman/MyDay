// Which icon a medicine gets, worked out from what is already known about it:
// its name and the form it comes in. No extra question in the wizard and no
// new column, so every existing medicine gets the right icon straight away.
//
// Pure, no React — tested in test/medIcon.test.js. Icons are a visual hint
// only; nothing here is medical advice or a classification anyone relies on.
import { MEDICINE_GROUPS } from './medicineNames.js';

// One kind per autocomplete group, plus the forms that read better as their
// own shape than as a category (an inhaler is an inhaler, whatever is in it).
export const MED_KINDS = {
  vitamins:      { icon: 'leaf',    label: 'Vitamin or supplement' },
  heart:         { icon: 'heart',   label: 'Heart, blood pressure or cholesterol' },
  bloodThinners: { icon: 'droplet', label: 'Blood thinner' },
  diabetes:      { icon: 'cube',    label: 'Diabetes' },
  stomach:       { icon: 'stomach', label: 'Stomach and digestion' },
  pain:          { icon: 'bolt',    label: 'Pain and inflammation' },
  bones:         { icon: 'bone',    label: 'Bones' },
  lungs:         { icon: 'lungs',   label: 'Lungs and allergies' },
  brain:         { icon: 'moon',    label: 'Brain, mood and sleep' },
  hormones:      { icon: 'flask',   label: 'Thyroid and hormones' },
  infections:    { icon: 'shield',  label: 'Infection' },
  eyesEarsSkin:  { icon: 'eye',     label: 'Eyes, ears and skin' },
  injection:     { icon: 'syringe', label: 'Injection' },
  inhaler:       { icon: 'inhaler', label: 'Inhaler' },
  drops:         { icon: 'dropper', label: 'Drops' },
  patch:         { icon: 'bandage', label: 'Patch' },
  liquid:        { icon: 'bottle',  label: 'Liquid' },
  cream:         { icon: 'tube',    label: 'Cream or ointment' },
  capsule:       { icon: 'capsule', label: 'Capsule' },
  tablet:        { icon: 'pill',    label: 'Tablet' },
};

// Every name in the list contributes its generic name and its brand, e.g.
// 'Atorvastatin (Lipitor)' -> 'atorvastatin' and 'lipitor'.
const KEYWORDS = [];
for (const [kind, names] of Object.entries(MEDICINE_GROUPS)) {
  for (const name of names) {
    const lower = name.toLowerCase();
    const generic = lower.split(' (')[0].trim();
    const brand = (lower.match(/\(([^)]+)\)/) || [])[1];
    KEYWORDS.push({ kw: generic, kind });
    if (brand && brand.length >= 3) KEYWORDS.push({ kw: brand.trim(), kind });
  }
}
// Longest first, so 'calcium carbonate' (stomach) beats 'calcium' (vitamin)
// and 'prednisolone eye drops' beats 'prednisolone'.
KEYWORDS.sort((a, b) => b.kw.length - a.kw.length);

// Drug-name endings, for medicines that are not in the list.
const STEMS = [
  [/(pril|sartan|olol|dipine|statin|thiazide|semide)$/, 'heart'],
  [/(xaban|gatran|grel)$/, 'bloodThinners'],
  [/(gliptin|gliflozin|glutide|formin)$/, 'diabetes'],
  [/(prazole|tidine)$/, 'stomach'],
  [/(profen|coxib|fenac)$/, 'pain'],
  [/(dronate)$/, 'bones'],
  [/(terol|lukast|tropium|tadine)$/, 'lungs'],
  [/(zepam|zolam|oxetine|triptyline|pezil)$/, 'brain'],
  [/(cillin|mycin|floxacin|cycline|conazole|clovir|cef\w*)$/, 'infections'],
];

const escape = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function formOf(med) {
  const unit = String(med?.dose_unit || '').toLowerCase();
  const text = `${med?.name || ''} ${med?.dose || ''} ${med?.dose_other || ''}`.toLowerCase();
  if (unit === 'injection' || /\b(injections?|pen|insulin)\b/.test(text)) return 'injection';
  if (unit === 'puff' || /\b(puffs?|inhaler)\b/.test(text)) return 'inhaler';
  if (unit === 'drop' || /\bdrops?\b/.test(text)) return 'drops';
  if (unit === 'patch' || /\bpatch(es)?\b/.test(text)) return 'patch';
  if (/\b(cream|ointment|gel|lotion)\b/.test(text)) return 'cream';
  if (unit === 'ml' || unit === 'sachet' || /\b(ml|sachets?|syrup|liquid)\b/.test(text)) return 'liquid';
  return null;
}

function categoryOf(name) {
  const n = String(name || '').toLowerCase();
  if (!n.trim()) return null;
  // Word-start match only: 'iron' must not match inside 'spironolactone'.
  for (const { kw, kind } of KEYWORDS) {
    if (new RegExp(`(^|[^a-z])${escape(kw)}`).test(n)) return kind;
  }
  if (/\b(vitamin|multivit|omega|supplement|mineral)/.test(n)) return 'vitamins';
  for (const word of n.split(/[^a-z]+/)) {
    for (const [re, kind] of STEMS) if (word.length > 5 && re.test(word)) return kind;
  }
  return null;
}

/** The kind key for a medicine — one of MED_KINDS. */
export function medKind(med) {
  return formOf(med) || categoryOf(med?.name)
    || (String(med?.dose_unit || '').toLowerCase() === 'capsule' || /\bcapsules?\b/i.test(med?.dose || '')
      ? 'capsule' : 'tablet');
}

/** Icon name (components/Icon.jsx) for a medicine. */
export function medIcon(med) {
  return MED_KINDS[medKind(med)].icon;
}

/** Plain-language kind, for a tooltip. */
export function medKindLabel(med) {
  return MED_KINDS[medKind(med)].label;
}
