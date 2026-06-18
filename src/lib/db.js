// All Supabase data access. RLS scopes every row to the signed-in user, and
// user_id defaults to auth.uid(), so inserts don't need to set it explicitly.
import { supabase } from './supabase.js';
import { deviceTimezone, localDateStr } from './format.js';

// ---------- profile ----------
export async function getProfile() {
  const { data, error } = await supabase.from('myday_profiles').select('*').maybeSingle();
  if (error) throw error;
  return data;
}
// Make sure a profile row exists for the signed-in user; keep timezone current.
export async function ensureProfile(user) {
  const tz = deviceTimezone();
  let prof = await getProfile();
  if (!prof) {
    const full_name = user?.user_metadata?.full_name || (user?.email ? user.email.split('@')[0] : '');
    const { data, error } = await supabase.from('myday_profiles')
      .insert({ user_id: user.id, full_name, timezone: tz }).select().single();
    if (error) throw error;
    prof = data;
  } else if (prof.timezone !== tz) {
    await supabase.from('myday_profiles').update({ timezone: tz }).eq('user_id', user.id);
    prof.timezone = tz;
  }
  return prof;
}
export async function saveProfile(patch) {
  const { error } = await supabase.from('myday_profiles').update(patch).neq('user_id', '00000000-0000-0000-0000-000000000000');
  if (error) throw error;
}

// ---------- medications ----------
export async function listMedications() {
  const { data, error } = await supabase.from('myday_medications')
    .select('*').eq('active', true).order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}
export async function saveMedication(med) {
  const row = { name: med.name, dose: med.dose, times: med.times, note: med.note || null, color: med.color || '#2563a8' };
  if (med.id) { const { error } = await supabase.from('myday_medications').update(row).eq('id', med.id); if (error) throw error; }
  else { const { error } = await supabase.from('myday_medications').insert(row); if (error) throw error; }
}
export async function deleteMedication(id) {
  const { error } = await supabase.from('myday_medications').update({ active: false }).eq('id', id);
  if (error) throw error;
}

// ---------- doses ----------
export async function refreshDoses(tz = deviceTimezone()) {
  const { error } = await supabase.rpc('myday_refresh_doses', { p_timezone: tz });
  if (error) throw error;
}
export async function dosesForDate(isoDate) {
  const { data, error } = await supabase.from('myday_doses')
    .select('*, medication:myday_medications(name,dose,note,color)')
    .eq('dose_date', isoDate).order('due_at', { ascending: true });
  if (error) throw error;
  return data || [];
}
export async function todaysDoses(tz = deviceTimezone()) {
  return dosesForDate(localDateStr(tz));
}
// All doses in a [from,to] date range (for the calendar).
export async function dosesInRange(fromIso, toIso) {
  const { data, error } = await supabase.from('myday_doses')
    .select('dose_date,status').gte('dose_date', fromIso).lte('dose_date', toIso);
  if (error) throw error;
  return data || [];
}
export async function markDoseTaken(id) {
  const { error } = await supabase.from('myday_doses')
    .update({ status: 'taken', taken_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}
export async function markDosePending(id) {
  const { error } = await supabase.from('myday_doses')
    .update({ status: 'pending', taken_at: null }).eq('id', id);
  if (error) throw error;
}

// ---------- appointments ----------
export async function upcomingAppointments(tz = deviceTimezone()) {
  const today = localDateStr(tz);
  const { data, error } = await supabase.from('myday_appointments').select('*')
    .gte('appt_date', today).order('appt_date', { ascending: true })
    .order('appt_time', { ascending: true, nullsFirst: true });
  if (error) throw error;
  return data || [];
}
export async function saveAppointment(a) {
  const row = { appt_date: a.appt_date, appt_time: a.appt_time || null, doctor_name: a.doctor_name || null, location: a.location || null, reason: a.reason || null };
  if (a.id) { const { error } = await supabase.from('myday_appointments').update(row).eq('id', a.id); if (error) throw error; }
  else { const { error } = await supabase.from('myday_appointments').insert(row); if (error) throw error; }
}
export async function deleteAppointment(id) {
  const { error } = await supabase.from('myday_appointments').delete().eq('id', id);
  if (error) throw error;
}

// ---------- diary / updates ----------
export async function listDiary(limit = 50) {
  const { data, error } = await supabase.from('myday_diary').select('*')
    .order('entry_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}
export async function saveDiary(entry) {
  const row = { category: entry.category, title: entry.title || null, body: entry.body || null, entry_at: entry.entry_at || new Date().toISOString() };
  if (entry.id) { const { error } = await supabase.from('myday_diary').update(row).eq('id', entry.id); if (error) throw error; }
  else { const { error } = await supabase.from('myday_diary').insert(row); if (error) throw error; }
}
export async function deleteDiary(id) {
  const { error } = await supabase.from('myday_diary').delete().eq('id', id);
  if (error) throw error;
}

// ---------- contacts ----------
export async function listContacts() {
  const { data, error } = await supabase.from('myday_contacts').select('*').order('type').order('name');
  if (error) throw error;
  return data || [];
}
export async function saveContact(c) {
  const row = { type: c.type, name: c.name, phone: c.phone || null, email: c.email || null, address: c.address || null, notes: c.notes || null };
  if (c.id) { const { error } = await supabase.from('myday_contacts').update(row).eq('id', c.id); if (error) throw error; }
  else { const { error } = await supabase.from('myday_contacts').insert(row); if (error) throw error; }
}
export async function deleteContact(id) {
  const { error } = await supabase.from('myday_contacts').delete().eq('id', id);
  if (error) throw error;
}

// ---------- games ----------
export async function saveGameResult(r) {
  const { error } = await supabase.from('myday_game_results').insert({
    game_type: r.game_type, score: r.score, max_score: r.max_score ?? null,
    difficulty: r.difficulty ?? 1, duration_seconds: r.duration_seconds ?? null, details: r.details ?? null,
  });
  if (error) throw error;
}
export async function lastDifficulty(gameType) {
  const { data, error } = await supabase.from('myday_game_results').select('difficulty')
    .eq('game_type', gameType).order('played_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data?.difficulty ?? 1;
}
export async function playedTodayCount(tz = deviceTimezone()) {
  const start = new Date(`${localDateStr(tz)}T00:00:00`);
  const { count, error } = await supabase.from('myday_game_results')
    .select('id', { count: 'exact', head: true }).gte('played_at', start.toISOString());
  if (error) throw error;
  return count || 0;
}
export async function recentResults(limit = 40) {
  const { data, error } = await supabase.from('myday_game_results').select('*')
    .order('played_at', { ascending: false }).limit(limit);
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
