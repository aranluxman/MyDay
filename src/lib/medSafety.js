// Medication safety: the boundary between MyDay and a verified clinical data
// service. NO such service is connected today, and this module is what keeps
// the app honest about that.
//
// Rules this file enforces (tested in test/medSafety.test.js):
//   * With no source connected, every check answers "not_connected". It never
//     answers "no interactions", "safe" or anything that could be read as an
//     all-clear: not having looked is not the same as having found nothing.
//   * A result may only be shown as a finding when it comes from a connected
//     source and carries that source's name and the date its data was updated.
//   * Nothing here changes a schedule, a dose or the spacing between doses.
//
// To connect a real service later, see docs/integrations/medication-safety.md:
// set the source for that check below and implement its `run` to call the
// service through a Supabase Edge Function (so the key never reaches the
// browser), returning the shape documented there.

/** @type {Record<string, null | { name: string, updated: string, run: Function }>} */
export const SAFETY_SOURCES = {
  interactions: null,
  side_effects: null,
  nutrients: null,
};

export const SAFETY_CHECKS = [
  { id: 'interactions', title: 'Interaction checker', icon: 'shield',
    what: 'Whether any of your medicines are known to affect each other.' },
  { id: 'side_effects', title: 'Side-effect information', icon: 'info',
    what: 'Known side effects for each medicine, from its official information.' },
  { id: 'nutrients', title: 'Nutrient information', icon: 'leaf',
    what: 'Whether a medicine is known to affect vitamins, minerals or food.' },
];

/** Is a verified source connected for this check? */
export function sourceFor(check, sources = SAFETY_SOURCES) {
  const s = sources[check];
  return s && s.name && s.updated && typeof s.run === 'function' ? s : null;
}

/**
 * Run one safety check.
 * @returns {Promise<
 *   { state: 'not_connected' } |
 *   { state: 'nothing_to_check' } |
 *   { state: 'error', message: string } |
 *   { state: 'checked', source: string, updated: string, checkedAt: string, findings: object[] }
 * >}
 * `findings` may be empty for a real, connected check. The screen words that
 * as "{source} lists no … for these medicines", with the source and date, and
 * still suggests a pharmacist review. It is never worded as "safe".
 */
export async function runSafetyCheck(check, meds, sources = SAFETY_SOURCES) {
  const source = sourceFor(check, sources);
  if (!source) return { state: 'not_connected' };
  const list = (meds || []).filter((m) => m && m.active !== false && String(m.name || '').trim());
  if (!list.length || (check === 'interactions' && list.length < 2)) return { state: 'nothing_to_check' };
  try {
    const findings = await source.run(list);
    if (!Array.isArray(findings)) return { state: 'error', message: 'The safety service returned something MyDay could not read.' };
    return { state: 'checked', source: source.name, updated: source.updated, checkedAt: new Date().toISOString(), findings };
  } catch {
    // A failed check is never shown as a clean one.
    return { state: 'error', message: 'The safety service could not be reached. Nothing was checked.' };
  }
}

/** The words for a check's status chip. Never an all-clear. */
export function statusWords(result) {
  switch (result?.state) {
    case 'checked': return { label: 'Checked', tone: 'info' };
    case 'nothing_to_check': return { label: 'Nothing to check yet', tone: 'info' };
    case 'error': return { label: 'Could not check', tone: 'warn' };
    default: return { label: 'Not checked · Service not connected', tone: 'warn' };
  }
}

/** One medicine as a plain line for a pharmacist: name, strength, amount, when. */
export function medicineLine(m, prettyTime = (t) => t) {
  const times = Array.isArray(m.times) ? m.times.filter(Boolean) : [];
  const when = m.frequency === 'as_needed' ? 'Only when needed'
    : times.length ? times.map(prettyTime).join(', ') : 'No times set';
  return {
    name: String(m.name || 'Medicine').trim(),
    strength: m.strength || null,
    amount: m.dose || null,
    when,
    instructions: m.instructions || null,
  };
}
