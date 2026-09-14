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
    // conflict-safe: sign-up may create this row concurrently
    await supabase.from('myday_profiles')
      .upsert({ user_id: user.id, full_name, timezone: tz }, { onConflict: 'user_id', ignoreDuplicates: true });
    prof = await getProfile();
  } else if (prof.timezone !== tz) {
    await supabase.from('myday_profiles').update({ timezone: tz }).eq('user_id', user.id);
    prof.timezone = tz;
  }
  return prof;
}
// Uploads a profile photo to the user's own folder and returns a public URL.
export async function uploadAvatar(userId, file) {
  const path = `${userId}/avatar`;
  const { error } = await supabase.storage.from('myday-avatars')
    .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
  if (error) throw error;
  const { data } = supabase.storage.from('myday-avatars').getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
}

// Saves a patch onto the signed-in user's profile. This is an upsert keyed on
// user_id so a save still works if the profile row was never created (an
// unscoped UPDATE silently matched nothing and looked like a successful save).
export async function saveProfile(patch) {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) throw new Error('You have been signed out. Please sign in again.');
  const { error } = await supabase.from('myday_profiles')
    .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' });
  if (error) throw new Error(profileErrorMessage(error));
}

// Turns a Postgres error into something an 80-year-old can act on, instead of
// the blanket "Could not save." that hid a constraint violation for months.
function profileErrorMessage(error) {
  const code = error?.code;
  if (code === '23514') return 'One of the answers was not recognised. Please pick an option and try again.';
  if (code === '22008' || code === '22007') return 'That date does not look right. Please check your birthday.';
  if (code === '42501' || code === 'PGRST301') return 'You have been signed out. Please sign in again.';
  if (error?.message?.includes('Failed to fetch')) return 'No internet connection. Please try again when you are back online.';
  return error?.message || 'Could not save.';
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
// A finished game is a small piece of someone's progress record, and the most
// likely moment to lose one is exactly when people play: on a tablet with patchy
// wifi. So a failed insert is kept on the device and replayed later rather than
// thrown away. saveGameResult still throws, so the screen can say what happened.
const PENDING_GAMES_KEY = 'myday_pending_games';

function readPendingGames() {
  try { const v = JSON.parse(localStorage.getItem(PENDING_GAMES_KEY) || '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function writePendingGames(rows) {
  // Cap the backlog so a long offline stretch can't fill up the device.
  try { localStorage.setItem(PENDING_GAMES_KEY, JSON.stringify(rows.slice(-100))); } catch { /* storage full or blocked */ }
}
export function pendingGameCount() { return readPendingGames().length; }

export async function saveGameResult(r) {
  const row = {
    game_type: r.game_type, score: r.score, max_score: r.max_score ?? null,
    difficulty: r.difficulty ?? 1, duration_seconds: r.duration_seconds ?? null,
    details: r.details ?? null, played_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('myday_game_results').insert(row);
  if (error) {
    writePendingGames([...readPendingGames(), row]);
    throw error;
  }
}

// Replays anything saved while offline. Called on sign-in and whenever the
// device comes back online. Rows that the server rejects outright (a bad
// game_type from an older build, say) are dropped so they can't jam the queue.
export async function flushPendingGameResults() {
  const rows = readPendingGames();
  if (!rows.length) return 0;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return 0;

  const stuck = [];
  let sent = 0;
  for (const row of rows) {
    const { error } = await supabase.from('myday_game_results').insert(row);
    if (!error) { sent++; continue; }
    // 4xx from PostgREST means this row will never be accepted; anything else
    // (network, 5xx) is worth another try later.
    const permanent = typeof error.code === 'string' && /^(22|23|42)/.test(error.code);
    if (!permanent) stuck.push(row);
  }
  writePendingGames(stuck);
  return sent;
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

// ---------- guardians (a linked person on their own device) ----------
// The patient owns these rows; a guardian registers their device via the
// public `guardian-join` edge function using the invite token below.
const GUARDIAN_COLS = 'id,name,phone,status,code,token,expires_at,created_at';

export async function createGuardianInvite(name, phone) {
  const { data, error } = await supabase.from('myday_guardians')
    .insert({ name, phone: phone || null })
    .select(GUARDIAN_COLS).single();
  if (error) throw error;
  return data;
}
export async function listGuardians() {
  const { data, error } = await supabase.from('myday_guardians')
    .select(`${GUARDIAN_COLS},devices:myday_guardian_devices(count)`)
    .order('created_at');
  if (error) throw error;
  return (data || []).map((g) => ({ ...g, deviceCount: g.devices?.[0]?.count || 0 }));
}
export async function deleteGuardian(id) {
  const { error } = await supabase.from('myday_guardians').delete().eq('id', id);
  if (error) throw error;
}
// Issues a fresh token + 7-day expiry (invalidating the old link) if one leaks
// or lapses. Keeps the guardian's current status so an active link isn't broken.
export async function regenerateGuardianInvite(id) {
  const token = crypto.randomUUID().replace(/-/g, '');
  const { data: code, error: codeErr } = await supabase.rpc('myday_new_guardian_code');
  if (codeErr) throw codeErr;
  const expires_at = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabase.from('myday_guardians')
    .update({ token, code, expires_at }).eq('id', id)
    .select(GUARDIAN_COLS).single();
  if (error) throw error;
  return data;
}
// The shareable link a guardian opens on their own phone. The 6-digit code is
// the primary route; this link is the "send it to them" fallback.
export function guardianInviteLink(token) {
  return `${window.location.origin}/guardian?invite=${token}`;
}
// "482915" -> "482 915": easier to read aloud and to copy down on paper.
export function formatGuardianCode(code) {
  const digits = String(code || '').replace(/\D/g, '');
  return digits.length === 6 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
}
