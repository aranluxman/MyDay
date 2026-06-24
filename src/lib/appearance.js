// Appearance options. Each theme id maps to a [data-theme] block in index.css;
// the swatch colors here are just for the picker preview.
export const THEMES = [
  { id: 'light', name: 'Light', bg: '#eef3f9', primary: '#2563a8', ink: '#15243b' },
  { id: 'dark', name: 'Dark', bg: '#0e1622', primary: '#4a9fe0', ink: '#e9f1f9' },
  { id: 'contrast', name: 'High contrast', bg: '#ffffff', primary: '#0a3aa6', ink: '#000000' },
  { id: 'warm', name: 'Warm', bg: '#fbf3e8', primary: '#a8560f', ink: '#3a2a1a' },
  { id: 'fresh', name: 'Fresh', bg: '#eef6ef', primary: '#18774c', ink: '#16302a' },
  { id: 'ocean', name: 'Ocean', bg: '#eaf3fb', primary: '#2563eb', ink: '#0f2747' },
  { id: 'rose', name: 'Rose', bg: '#fbeef4', primary: '#c43d77', ink: '#3a1f2e' },
  { id: 'midnight', name: 'Midnight', bg: '#0b1020', primary: '#8b9cff', ink: '#e8ecff' },
];
export const THEME_IDS = THEMES.map((t) => t.id);

export const TEXT_SIZES = [
  { id: 'normal', name: 'Normal' },
  { id: 'large', name: 'Large' },
  { id: 'xlarge', name: 'Larger' },
];

// Profile-completeness fields (each worth an equal share).
const COMPLETE_FIELDS = ['full_name', 'avatar_url', 'birthday', 'sex', 'for_whom', 'on_treatment', 'goal'];
export function profileCompleteness(profile) {
  if (!profile) return { pct: 0, done: 0, total: COMPLETE_FIELDS.length, missing: COMPLETE_FIELDS };
  const filled = COMPLETE_FIELDS.filter((f) => profile[f] != null && String(profile[f]).trim() !== '');
  const missing = COMPLETE_FIELDS.filter((f) => !filled.includes(f));
  return { pct: Math.round((filled.length / COMPLETE_FIELDS.length) * 100), done: filled.length, total: COMPLETE_FIELDS.length, missing };
}
