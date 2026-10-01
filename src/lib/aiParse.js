// Checking what the AI hands back before the app acts on it.
//
// The model proposes; the app decides. Everything that comes back from the
// ai-assist function passes through here first, so a misread label or a
// confused reply can only ever produce a value the app already allows — never
// an unknown setting, a made-up unit or a birthday in the future.
//
// Pure functions, no browser APIs, so they are unit-tested in test/aiParse.test.js.
import { UNIT_IDS, clampAmount } from './doseUnits.js';
import { FREQUENCY_IDS, normaliseTimes } from './schedule.js';
import { THEME_IDS, TEXT_SIZES } from './appearance.js';

export const TEXT_SIZE_IDS = TEXT_SIZES.map((s) => s.id);

/* --------------------------- medicine photo scan --------------------------- */

/**
 * Turns a scan result into the Add Medicine wizard's form fields. Anything
 * missing or out of range falls back to the wizard's own defaults, so the
 * person always lands on a form they can save or correct.
 */
export function normaliseScan(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const unit = UNIT_IDS.includes(r.dose_unit) ? r.dose_unit : 'tablet';
  const frequency = FREQUENCY_IDS.includes(r.frequency) ? r.frequency : 'daily';
  const days = [...new Set((Array.isArray(r.days_of_week) ? r.days_of_week : [])
    .map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  const times = normaliseTimes(r.times);
  const warnings = (Array.isArray(r.warnings) ? r.warnings : [])
    .map((w) => String(w || '').trim()).filter(Boolean).slice(0, 4);

  // "Certain days" with no days is not saveable; fall back rather than strand them.
  const safeFrequency = frequency === 'days_of_week' && !days.length ? 'daily' : frequency;

  return {
    isMedicine: r.is_medicine !== false,
    confidence: ['high', 'medium', 'low'].includes(r.confidence) ? r.confidence : 'low',
    warnings,
    form: {
      name: String(r.name || '').trim().slice(0, 80),
      dose_amount: clampAmount(r.dose_amount ?? 1),
      dose_unit: unit,
      dose_other: unit === 'other' ? String(r.dose_other || '').trim().slice(0, 30) : '',
      times: times.length ? times : ['08:00'],
      frequency: safeFrequency,
      days_of_week: safeFrequency === 'days_of_week' ? days : [],
      with_food: r.with_food === true,
      note: String(r.note || '').trim().slice(0, 120),
    },
  };
}

/* ------------------------------ in-app helper ------------------------------ */

const BOOLEAN_SETTINGS = ['highContrast', 'bold', 'bigButtons', 'calmMotion', 'homeCalendar', 'homeGames'];
const PROFILE_FIELDS = ['full_name', 'birthday', 'goal', 'on_treatment', 'for_whom'];
export const NAV_PATHS = ['/', '/medication', '/appointments', '/updates', '/games', '/cards', '/profile/notifications'];

const SETTING_LABELS = {
  highContrast: 'More contrast', bold: 'Bold text', bigButtons: 'Bigger buttons',
  calmMotion: 'Calm screen', homeCalendar: 'Calendar on Home', homeGames: 'Brain games on Home',
  clock: 'Time format',
};
const PROFILE_LABELS = {
  full_name: 'Name', birthday: 'Birthday', goal: 'Health goal',
  on_treatment: 'Medications & conditions', for_whom: 'Who MyDay is for',
};
const NAV_LABELS = {
  '/': 'Home', '/medication': 'Medicine', '/appointments': 'Visits', '/updates': 'Updates',
  '/games': 'Brain Games', '/cards': 'My cards', '/profile/notifications': 'Notification settings',
};

/** A real calendar date, YYYY-MM-DD, not after `today`. */
export function validBirthday(value, today = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const iso = m[0];
  if (iso > todayStr || y < today.getFullYear() - 130) return null;
  return iso;
}

/**
 * Keeps only the actions the app knows how to apply, with values it allows.
 * Returns { actions, rejected } — rejected ones are reported, never applied.
 * Each kept action carries a plain-words `label` for the "what I changed" list.
 */
export function validateActions(list, today = new Date()) {
  const actions = [];
  const rejected = [];
  const seen = new Set();
  for (const a of Array.isArray(list) ? list.slice(0, 8) : []) {
    const type = a?.type;
    const key = String(a?.key ?? '').trim();
    const value = String(a?.value ?? '').trim();
    let ok = null;

    if (type === 'set_text_size' && TEXT_SIZE_IDS.includes(value)) {
      ok = { type, value, label: `Text size: ${TEXT_SIZES.find((s) => s.id === value).name}` };
    } else if (type === 'set_theme' && THEME_IDS.includes(value)) {
      ok = { type, value, label: `Theme: ${value === 'contrast' ? 'High contrast' : value[0].toUpperCase() + value.slice(1)}` };
    } else if (type === 'set_setting' && BOOLEAN_SETTINGS.includes(key) && (value === 'true' || value === 'false')) {
      ok = { type, key, value: value === 'true', label: `${SETTING_LABELS[key]}: ${value === 'true' ? 'on' : 'off'}` };
    } else if (type === 'set_setting' && key === 'clock' && (value === '12' || value === '24')) {
      ok = { type, key, value, label: `${SETTING_LABELS.clock}: ${value === '12' ? '2:30 PM' : '14:30'}` };
    } else if (type === 'update_profile' && PROFILE_FIELDS.includes(key)) {
      ok = profileAction(key, value, today);
    } else if (type === 'navigate' && NAV_PATHS.includes(value)) {
      ok = { type, value, label: `Opening ${NAV_LABELS[value]}` };
    }

    if (!ok) { rejected.push(a); continue; }
    // The last word on the same thing wins, once.
    const id = `${ok.type}:${ok.key || ''}`;
    if (seen.has(id)) {
      const i = actions.findIndex((x) => `${x.type}:${x.key || ''}` === id);
      actions.splice(i, 1);
    }
    seen.add(id);
    actions.push(ok);
  }
  // Navigating away first would unmount the screen before the rest applied.
  actions.sort((x, y) => (x.type === 'navigate') - (y.type === 'navigate'));
  return { actions, rejected };
}

function profileAction(key, value, today) {
  const type = 'update_profile';
  if (key === 'birthday') {
    const iso = validBirthday(value, today);
    return iso ? { type, key, value: iso, label: `${PROFILE_LABELS.birthday}: ${prettyIso(iso)}` } : null;
  }
  if (key === 'for_whom') {
    return value === 'self' || value === 'other'
      ? { type, key, value, label: `${PROFILE_LABELS.for_whom}: ${value === 'self' ? 'Myself' : 'A loved one'}` }
      : null;
  }
  const max = key === 'full_name' ? 60 : 300;
  const clean = value.slice(0, max);
  if (!clean) return null;
  return { type, key, value: clean, label: `${PROFILE_LABELS[key]}: ${clean}` };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function prettyIso(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** A stable key for a medicine list, so an explanation is reused until the list changes. */
export function medsSignature(meds) {
  return (meds || [])
    .map((m) => `${String(m.name || '').trim().toLowerCase()}|${m.dose || ''}|${m.frequency || ''}`)
    .sort()
    .join('\n');
}

/* ----------------------------- diary note chat ----------------------------- */

/**
 * A note-chat turn made safe to show: always a reply, at most three short
 * tap-to-answer suggestions, and `urgent` only when the model said exactly true.
 */
export function normaliseChatReply(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const reply = String(r.reply || '').trim().slice(0, 1200)
    || 'Sorry, I did not catch that. Could you tell me a little more?';
  const suggestions = [...new Set((Array.isArray(r.suggestions) ? r.suggestions : [])
    .map((x) => String(x || '').trim()).filter((x) => x && x.length <= 40))].slice(0, 3);
  return { reply, suggestions, urgent: r.urgent === true };
}
