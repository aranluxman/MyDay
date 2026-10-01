// Talking to the ai-assist Edge Function. The OpenAI key is never here — it is
// a Supabase function secret — so everything goes through the person's own
// signed-in session.
import { supabase } from './supabase.js';
import { compressImage } from './db.js';
import { describeSchedule } from './schedule.js';
import { prettyTime } from './format.js';

async function call(body) {
  const { data, error } = await supabase.functions.invoke('ai-assist', { body });
  if (error) {
    // The function's own plain-words message, when it sent one.
    let msg = 'The helper is not available right now. Please try again.';
    try { const b = await error.context.json(); if (b?.error) msg = b.error; } catch {}
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data?.result;
}

function toDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read that photo. Please try another.'));
    r.readAsDataURL(blob);
  });
}

/** Reads a photo of a medicine label. Returns the raw scan (see normaliseScan). */
export async function scanMedicinePhoto(file) {
  // Big enough to read small print on a pharmacy label, small enough to send
  // quickly on hospital wifi.
  const blob = await compressImage(file, 1600, 0.85);
  return call({ mode: 'scan_medicine', image: await toDataUrl(blob) });
}

/** Plain-language explanation of the whole medicine list. */
export async function analyzeMedicines(meds, goal) {
  return call({
    mode: 'analyze_medicines',
    goal: goal || '',
    meds: meds.map((m) => ({
      name: m.name,
      dose: m.dose,
      schedule: describeSchedule(m, { prettyTime }),
    })),
  });
}
