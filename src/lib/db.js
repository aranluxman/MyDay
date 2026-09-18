// All Supabase data access. RLS scopes every row to the signed-in user, and
// user_id defaults to auth.uid(), so inserts don't need to set it explicitly.
import { supabase } from './supabase.js';
import { deviceTimezone, localDateStr } from './format.js';
import { PREF_DEFAULTS } from './notifications.js';

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
// `dose` stays the display string built from the structured fields, so every
// existing screen and the push notification bodies keep working while the
// amount/unit pair becomes the thing people actually edit.
export async function saveMedication(med) {
  const row = {
    name: med.name,
    dose: med.dose,
    times: med.times,
    note: med.note || null,
    color: med.color || '#2563a8',
    dose_amount: med.dose_amount ?? null,
    dose_unit: med.dose_unit ?? null,
    dose_other: med.dose_other || null,
    frequency: med.frequency || 'daily',
    // An empty weekday list would fail the CHECK, and only 'days_of_week'
    // should carry one at all.
    days_of_week: med.frequency === 'days_of_week' && med.days_of_week?.length
      ? med.days_of_week : null,
    start_date: med.start_date || null,
    end_date: med.end_date || null,
    with_food: !!med.with_food,
    photo_path: med.photo_path ?? null,
    reminders_enabled: med.reminders_enabled !== false,
    alert_window_override: med.alert_window_override ?? null,
  };
  if (med.id) {
    const { error } = await supabase.from('myday_medications').update(row).eq('id', med.id);
    if (error) throw error;
    return med.id;
  }
  const { data, error } = await supabase.from('myday_medications').insert(row).select('id').single();
  if (error) throw error;
  return data.id;
}

// Soft delete, so the dose history that points at this medicine survives.
export async function deleteMedication(id) {
  const { error } = await supabase.from('myday_medications').update({ active: false }).eq('id', id);
  if (error) throw error;
}

// Undo for a removal. The row was only deactivated, so this is a flag flip.
export async function restoreMedication(id) {
  const { error } = await supabase.from('myday_medications').update({ active: true }).eq('id', id);
  if (error) throw error;
}

// "Duplicate" for a medicine taken at several strengths or times. The copy is
// deliberately marked so two identical rows are never confusable in the list.
export async function duplicateMedication(med) {
  const { id, created_at, updated_at, user_id, ...rest } = med;
  return saveMedication({ ...rest, name: `${med.name} (copy)` });
}

// Pill / box photos live in a PRIVATE bucket (a photo of a medicine box is
// health data), so they are only ever read through a short-lived signed URL.
export async function uploadMedPhoto(file, onProgress) {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) throw new Error('You have been signed out. Please sign in again.');

  const blob = await compressImage(file, 1600, 0.82);
  const path = `${userId}/${crypto.randomUUID()}.webp`;
  onProgress?.(0.35);
  const { error } = await supabase.storage.from('myday-med-photos')
    .upload(path, blob, { contentType: 'image/webp', upsert: false });
  if (error) throw error;
  onProgress?.(1);
  return path;
}

export async function medPhotoUrl(path, seconds = 3600) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from('myday-med-photos').createSignedUrl(path, seconds);
  if (error) return null;
  return data?.signedUrl || null;
}

export async function deleteMedPhoto(path) {
  if (!path) return;
  await supabase.storage.from('myday-med-photos').remove([path]);
}

// Downscale and re-encode in the browser before upload. A modern phone camera
// produces 4-8MB files; a legible photo of a pill box needs a fraction of that,
// and the person is often on hospital wifi.
export async function compressImage(file, maxEdge = 1600, quality = 0.82) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const blob = await new Promise((resolve) => {
    // Safari only gained toBlob('image/webp') recently, so fall back to JPEG
    // rather than silently uploading a 0-byte file.
    canvas.toBlob((b) => (b ? resolve(b) : canvas.toBlob(resolve, 'image/jpeg', quality)), 'image/webp', quality);
  });
  if (!blob) throw new Error('Could not read that photo. Please try another.');
  return blob;
}

// Names already on this person's list, newest first — the autocomplete's
// "recently added" suggestions.
export async function recentMedicineNames(limit = 12) {
  const { data, error } = await supabase.from('myday_medications')
    .select('name').order('created_at', { ascending: false }).limit(limit);
  if (error) return [];
  return (data || []).map((r) => r.name).filter(Boolean);
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
// "Not today": a deliberate decision, not a failure. It is its own status so
// the sweep never turns it into a missed-dose alert and the adherence history
// does not count it against the person.
export async function markDoseSkipped(id, reason) {
  const trimmed = String(reason || '').trim().slice(0, 80);
  const { error } = await supabase.from('myday_doses')
    .update({ status: 'skipped', taken_at: null, skipped_at: new Date().toISOString(), skip_reason: trimmed || null })
    .eq('id', id);
  if (error) throw error;
}
// Undo, for either outcome. Clearing skip_reason matters: leaving a stale
// reason on a dose that is pending again would make the history lie.
export async function markDosePending(id) {
  const { error } = await supabase.from('myday_doses')
    .update({ status: 'pending', taken_at: null, skipped_at: null, skip_reason: null }).eq('id', id);
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
const GUARDIAN_COLS =
  'id,name,phone,status,code,token,expires_at,code_expires_at,code_used_at,last_dashboard_at,share_diary,created_at';
// Only the fields the senior needs to recognise and revoke a device. The token
// hash is never selected — there is nothing useful to do with it client-side.
const GUARDIAN_DEVICE_COLS = 'id,label,platform,last_seen_at,push_enabled,revoked_at,created_at';

export async function createGuardianInvite(name, phone) {
  const { data, error } = await supabase.from('myday_guardians')
    .insert({ name, phone: phone || null })
    .select(GUARDIAN_COLS).single();
  if (error) throw error;
  // The column default mints a code but no expiry, and a code with no expiry
  // must never be treated as valid, so issue a real 15-minute one immediately.
  return issueGuardianCode(data.id).then((c) => ({ ...data, ...c })).catch(() => data);
}

// Fresh 6-digit code + 15-minute expiry, replacing any previous one.
export async function issueGuardianCode(guardianId) {
  const { data, error } = await supabase
    .rpc('myday_issue_guardian_code', { p_guardian_id: guardianId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { code: row?.code, code_expires_at: row?.code_expires_at, code_used_at: null };
}

export async function listGuardians() {
  const { data, error } = await supabase.from('myday_guardians')
    .select(`${GUARDIAN_COLS},devices:myday_guardian_devices(${GUARDIAN_DEVICE_COLS})`)
    .order('created_at');
  if (error) throw error;
  return (data || []).map((g) => {
    // A revoked device is kept in the table for the audit trail, but it is not
    // a connection any more, so it must not be counted as one.
    const live = (g.devices || []).filter((d) => !d.revoked_at);
    return {
      ...g,
      devices: live,
      revokedDevices: (g.devices || []).filter((d) => d.revoked_at),
      deviceCount: live.length,
      lastSeenAt: live.map((d) => d.last_seen_at).filter(Boolean).sort().pop() || null,
    };
  });
}

// Instantly kills one device's token. The edge function filters on revoked_at,
// so the next dashboard request that device makes fails.
export async function revokeGuardianDevice(deviceId) {
  const { error } = await supabase.rpc('myday_revoke_guardian_device', { p_device_id: deviceId });
  if (error) throw error;
}

// Diary notes are the one category a guardian sees only by explicit choice.
export async function setGuardianShareDiary(guardianId, share) {
  const { error } = await supabase.from('myday_guardians')
    .update({ share_diary: !!share }).eq('id', guardianId);
  if (error) throw error;
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

// ---------- notification preferences ----------

export async function getNotificationPrefs() {
  const { data, error } = await supabase.from('myday_notification_prefs').select('*').maybeSingle();
  if (error) throw error;
  // A missing row is not an error: it means this account predates the table,
  // so the defaults apply until they change something.
  return { ...PREF_DEFAULTS, ...(data || {}) };
}

export async function saveNotificationPrefs(patch) {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) throw new Error('You have been signed out. Please sign in again.');
  const { error } = await supabase.from('myday_notification_prefs')
    .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' });
  if (error) throw error;
}

// Per-device delivery state, so a person can see WHY nothing arrived rather
// than being left to guess.
export async function listNotificationDevices() {
  const { data, error } = await supabase.from('myday_family_devices')
    .select('id,label,platform,push_enabled,last_delivered_at,last_notified_at,last_error,created_at')
    .order('created_at');
  if (error) throw error;
  return data || [];
}

export async function forgetNotificationDevice(id) {
  const { error } = await supabase.from('myday_family_devices').delete().eq('id', id);
  if (error) throw error;
}

// Registers this device, recording what it is and whether it is installed —
// both of which change whether alerts can be delivered at all.
export async function registerThisDevice(label, subscription, meta = {}) {
  const sub = subscription.toJSON ? subscription.toJSON() : subscription;
  const { error } = await supabase.from('myday_family_devices').upsert({
    label,
    endpoint: sub.endpoint,
    subscription: sub,
    platform: meta.platform || null,
    installed: meta.installed ?? null,
    push_enabled: true,
    last_error: null,
  }, { onConflict: 'endpoint' });
  if (error) throw error;
}

// Per-medicine reminder overrides.
export async function setMedicationReminders(id, { enabled, windowMinutes } = {}) {
  const patch = {};
  if (enabled != null) patch.reminders_enabled = !!enabled;
  if (windowMinutes !== undefined) patch.alert_window_override = windowMinutes ?? null;
  const { error } = await supabase.from('myday_medications').update(patch).eq('id', id);
  if (error) throw error;
}
