// Appearance options. Each theme id maps to a [data-theme] block in solid.css;
// the swatch colors here are just for the picker preview. Eight light themes,
// each checked for contrast (text at least 12:1 on its background, white at
// least 5.5:1 on its buttons), plus Dark and High contrast. "light" is the
// green MyDay look and stays the default id, so nobody's saved choice breaks.
export const THEMES = [
  { id: 'light', name: 'Green', bg: '#f6f9f7', primary: '#175c43', ink: '#172c23' },
  { id: 'ocean', name: 'Ocean', bg: '#eff6ff', primary: '#175cd3', ink: '#142d4e' },
  { id: 'sky', name: 'Sky', bg: '#eef7fb', primary: '#0a6a8f', ink: '#0f2a38' },
  { id: 'sage', name: 'Sage', bg: '#f2f6f3', primary: '#3c6a53', ink: '#1d2b24' },
  { id: 'lavender', name: 'Lavender', bg: '#f5f2fc', primary: '#6941c6', ink: '#2a1f45' },
  { id: 'rose', name: 'Rose', bg: '#fcf2f5', primary: '#ad2f5c', ink: '#3a1a26' },
  { id: 'peach', name: 'Peach', bg: '#fdf5ef', primary: '#b2461f', ink: '#3a2418' },
  { id: 'sand', name: 'Sand', bg: '#f8f4ec', primary: '#85582a', ink: '#33281c' },
  { id: 'dark', name: 'Dark', bg: '#0f1712', primary: '#5fc98a', ink: '#e8f2ec' },
  { id: 'contrast', name: 'High contrast', bg: '#ffffff', primary: '#0a3aa6', ink: '#000000' },
];
export const THEME_IDS = THEMES.map((t) => t.id);

// Themes that were retired in November 2026, and the closest one now. A saved
// old choice paints as its nearest match instead of falling back to default.
export const RETIRED_THEMES = {
  warm: 'peach', autumn: 'peach', fresh: 'sage', mint: 'light', sunshine: 'sand',
  ruby: 'rose', midnight: 'dark', 'forest-night': 'dark', 'plum-night': 'dark',
};
/** A stored theme id as it is today (retired ids mapped to their match). */
export function currentTheme(theme) { return RETIRED_THEMES[theme] || theme; }

// Light or dark, separate from the colour theme. "System" follows the
// device's own setting and is stored as the theme id 'system'; picking a
// colour swatch stores that swatch, and the mode reads from it.
export const MODES = [
  { id: 'system', name: 'System' },
  { id: 'light', name: 'Light' },
  { id: 'dark', name: 'Dark' },
];
const DARK_THEMES = new Set(['dark']);

/** The theme actually painted: 'system' becomes light or dark. */
export function resolveTheme(theme, prefersDark = false) {
  if (theme === 'system') return prefersDark ? 'dark' : 'light';
  const t = currentTheme(theme);
  return THEME_IDS.includes(t) ? t : 'light';
}

/** Which of System / Light / Dark a stored theme belongs to. */
export function modeOf(theme) {
  if (theme === 'system') return 'system';
  return DARK_THEMES.has(currentTheme(theme)) ? 'dark' : 'light';
}

/**
 * The theme to store when someone taps a mode. A colour they already chose
 * survives when it fits the mode (Ocean stays Ocean on "Light").
 */
export function themeForMode(mode, current) {
  if (mode === 'system') return 'system';
  return modeOf(current) === mode ? currentTheme(current) : mode;
}

/** The top-bar button steps System → Light → Dark → System. */
export function nextMode(theme) {
  const order = MODES.map((m) => m.id);
  return order[(order.indexOf(modeOf(theme)) + 1) % order.length];
}

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
