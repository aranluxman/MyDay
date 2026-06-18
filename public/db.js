// Data-access layer. All Supabase reads/writes live here so the UI modules
// stay focused on rendering. Also owns the shared date/timezone helpers.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { SUPABASE_URL, SUPABASE_KEY, PATIENT_ID } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

export { PATIENT_ID };

// ---------- date / timezone helpers ----------
export function deviceTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch { return 'UTC'; }
}

// 'YYYY-MM-DD' for *today* in the given timezone (defaults to device tz).
export function localDateStr(tz = deviceTimezone(), date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
}

// '09:00' (24h) -> '9:00 AM'
export function prettyTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// A Date -> '9:05 AM'
export function prettyClock(d) {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// '2026-06-18' -> 'Thursday, June 18'
export function prettyDate(isoDate) {
  const [y, mo, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, mo - 1, d);
  return dt.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

// ---------- settings ----------
export async function loadSettings() {
  const { data, error } = await supabase
    .from('myday_settings').select('*').eq('patient_id', PATIENT_ID).maybeSingle();
  if (error) throw error;
  return data;
}

// Make sure the stored timezone matches this device so the server cron computes
// due times correctly. Never clobbers the patient's name.
export async function syncTimezone() {
  const tz = deviceTimezone();
  const s = await loadSettings();
  if (!s) {
    await supabase.from('myday_settings')
      .insert({ patient_id: PATIENT_ID, timezone: tz });
  } else if (s.timezone !== tz) {
    await supabase.from('myday_settings')
      .update({ timezone: tz }).eq('patient_id', PATIENT_ID);
  }
  return tz;
}

export async function saveSettings(patch) {
  const { error } = await supabase.from('myday_settings')
    .update(patch).eq('patient_id', PATIENT_ID);
  if (error) throw error;
}

// ---------- medications + doses ----------
export async function listMedications() {
  const { data, error } = await supabase
    .from('myday_medications').select('*').eq('active', true)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function saveMedication(med) {
  const row = {
    name: med.name, dose: med.dose, times: med.times,
    note: med.note || null,
  };
  if (med.id) {
    const { error } = await supabase.from('myday_medications').update(row).eq('id', med.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('myday_medications').insert(row);
    if (error) throw error;
  }
}

// Soft delete so historical dose records stay meaningful.
export async function deleteMedication(id) {
  const { error } = await supabase.from('myday_medications')
    .update({ active: false }).eq('id', id);
  if (error) throw error;
}

// Ensure today's dose rows exist and flip overdue ones to missed (server-side
// logic in one RPC, so the client and the cron agree). Then read today's doses.
export async function refreshDoses(tz = deviceTimezone()) {
  const { error } = await supabase.rpc('myday_refresh_doses', { p_timezone: tz });
  if (error) throw error;
}

export async function todaysDoses(tz = deviceTimezone()) {
  const today = localDateStr(tz);
  const { data, error } = await supabase
    .from('myday_doses')
    .select('*, medication:myday_medications(name,dose,note)')
    .eq('dose_date', today)
    .order('due_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function markDoseTaken(id) {
  const { error } = await supabase.from('myday_doses')
    .update({ status: 'taken', taken_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// ---------- appointments ----------
export async function upcomingAppointments(tz = deviceTimezone()) {
  const today = localDateStr(tz);
  const { data, error } = await supabase
    .from('myday_appointments').select('*')
    .gte('appt_date', today)
    .order('appt_date', { ascending: true })
    .order('appt_time', { ascending: true, nullsFirst: true });
  if (error) throw error;
  return data || [];
}

export async function saveAppointment(appt) {
  const row = {
    appt_date: appt.appt_date, appt_time: appt.appt_time || null,
    doctor_name: appt.doctor_name || null, location: appt.location || null,
    reason: appt.reason || null,
  };
  if (appt.id) {
    const { error } = await supabase.from('myday_appointments').update(row).eq('id', appt.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('myday_appointments').insert(row);
    if (error) throw error;
  }
}

export async function deleteAppointment(id) {
  const { error } = await supabase.from('myday_appointments').delete().eq('id', id);
  if (error) throw error;
}

// ---------- games ----------
export async function saveGameResult(r) {
  const { error } = await supabase.from('myday_game_results').insert({
    game_type: r.game_type, score: r.score, max_score: r.max_score ?? null,
    difficulty: r.difficulty ?? 1, duration_seconds: r.duration_seconds ?? null,
    details: r.details ?? null,
  });
  if (error) throw error;
}

// Most recent difficulty for a game type, so play resumes where he left off.
export async function lastDifficulty(gameType) {
  const { data, error } = await supabase.from('myday_game_results')
    .select('difficulty').eq('game_type', gameType)
    .order('played_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data?.difficulty ?? 1;
}

export async function playedTodayCount(tz = deviceTimezone()) {
  const today = localDateStr(tz);
  const start = new Date(`${today}T00:00:00`);
  const { count, error } = await supabase.from('myday_game_results')
    .select('id', { count: 'exact', head: true })
    .gte('played_at', start.toISOString());
  if (error) throw error;
  return count || 0;
}

export async function recentResults(limit = 30) {
  const { data, error } = await supabase.from('myday_game_results')
    .select('*').order('played_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

// ---------- family devices (push) ----------
export async function saveFamilyDevice(label, subscription) {
  const sub = subscription.toJSON ? subscription.toJSON() : subscription;
  const { error } = await supabase.from('myday_family_devices')
    .upsert({ label, endpoint: sub.endpoint, subscription: sub }, { onConflict: 'endpoint' });
  if (error) throw error;
}

export async function listFamilyDevices() {
  const { data, error } = await supabase.from('myday_family_devices')
    .select('id,label,created_at,last_notified_at').order('created_at');
  if (error) throw error;
  return data || [];
}
