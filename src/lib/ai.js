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

export const MAX_SCAN_PHOTOS = 3;

/**
 * Reads up to three photos of the same medicine — front, back, pharmacy label —
 * as one. Returns the raw scan (see normaliseScan).
 */
export async function scanMedicinePhotos(files) {
  const list = [...files].slice(0, MAX_SCAN_PHOTOS);
  if (!list.length) throw new Error('Please add a photo first.');
  // Big enough to read small print on a pharmacy label, small enough that
  // three of them still send quickly on hospital wifi.
  const edge = list.length > 1 ? 1400 : 1600;
  const images = await Promise.all(list.map(async (f) => toDataUrl(await compressImage(f, edge, 0.82))));
  // `image` keeps an older deployed ai-assist working (it reads just the first).
  return call({ mode: 'scan_medicine', image: images[0], images });
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

/**
 * One turn of the encouraging chat about a health-diary note (Updates).
 * `doses` is today's list as { name, time, status }. Returns the raw
 * { reply, suggestions, urgent } — pass it through normaliseChatReply.
 */
export async function chatAboutNote({ entry, recent = [], doses = [], history = [], message = '' }) {
  return call({
    mode: 'note_chat',
    entry: { category: entry.category, title: entry.title, body: entry.body, entry_at: entry.entry_at },
    recent: recent.map((r) => ({ title: r.title, category: r.category, entry_at: r.entry_at })),
    doses,
    history,
    message,
  });
}
