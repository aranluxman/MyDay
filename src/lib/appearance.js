// Appearance options. Each theme id maps to a [data-theme] block in index.css;
// the swatch colors here are just for the picker preview.
export const THEMES = [
  { id: 'light', name: 'Light', bg: '#eef3f9', primary: '#2563a8', ink: '#15243b' },
  { id: 'dark', name: 'Dark', bg: '#0e1622', primary: '#4a9fe0', ink: '#e9f1f9' },
  { id: 'contrast', name: 'High contrast', bg: '#ffffff', primary: '#0a3aa6', ink: '#000000' },
  { id: 'warm', name: 'Warm', bg: '#fbf3e8', primary: '#a1520e', ink: '#3a2a1a' },
  { id: 'fresh', name: 'Fresh', bg: '#eef6ef', primary: '#18774c', ink: '#16302a' },
  { id: 'ocean', name: 'Ocean', bg: '#eaf3fb', primary: '#2060eb', ink: '#0f2747' },
  { id: 'rose', name: 'Rose', bg: '#fbeef4', primary: '#b3376c', ink: '#3a1f2e' },
  { id: 'midnight', name: 'Midnight', bg: '#0b1020', primary: '#8b9cff', ink: '#e8ecff' },
];
export const THEME_IDS = THEMES.map((t) => t.id);

export const TEXT_SIZES = [
  { id: 'normal', name: 'Normal' },
  { id: 'large', name: 'Large' },
  { id: 'xlarge', name: 'Larger' },
  { id: 'huge', name: 'Largest' },
];

// Profile completeness. Creating the account (name + who MyDay is for, both
// asked at sign-up) is worth a third on its own, so a brand-new person starts
// at 33% rather than near zero; the four extras share the remaining two thirds.
const BASE_FIELDS = ['full_name', 'for_whom'];
const EXTRA_FIELDS = ['avatar_url', 'birthday', 'on_treatment', 'goal'];
const COMPLETE_FIELDS = [...BASE_FIELDS, ...EXTRA_FIELDS];
export const BASE_PCT = 33;

const isFilled = (profile, f) => profile?.[f] != null && String(profile[f]).trim() !== '';

export function profileCompleteness(profile) {
  const filled = COMPLETE_FIELDS.filter((f) => isFilled(profile, f));
  const missing = COMPLETE_FIELDS.filter((f) => !filled.includes(f));
  const extras = EXTRA_FIELDS.filter((f) => isFilled(profile, f)).length;
  const pct = Math.min(100, Math.max(0, BASE_PCT + Math.round(((100 - BASE_PCT) * extras) / EXTRA_FIELDS.length)));
  // 100% only when nothing at all is left on the checklist.
  return { pct: missing.length ? Math.min(pct, 99) : 100, done: filled.length, total: COMPLETE_FIELDS.length, missing };
}
