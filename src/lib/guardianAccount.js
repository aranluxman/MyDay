import { supabase, SUPABASE_URL, SUPABASE_KEY } from './supabase.js';
import { deviceLabel, getGuardianToken, platformTag } from './guardian.js';

const ENDPOINT = `${SUPABASE_URL}/functions/v1/guardian-data`;

async function call(body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Please sign in first.');
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok || data.error) throw new Error(data.error || 'Could not load your guardian connection.');
  return data;
}

function tokenKey(userId, linkId) { return `myday_account_guardian_token:${userId}:${linkId}`; }
async function saveToken(linkId, token) {
  if (!linkId || !token) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.id) try { localStorage.setItem(tokenKey(user.id, linkId), token); } catch {}
}
export function getAccountGuardianToken(userId, linkId) {
  if (!userId || !linkId) return null;
  try { return localStorage.getItem(tokenKey(userId, linkId)); } catch { return null; }
}
export function clearAccountGuardianToken(userId, linkId) {
  if (!userId || !linkId) return;
  try { localStorage.removeItem(tokenKey(userId, linkId)); } catch {}
}

export async function claimGuestGuardianConnection() {
  const token = getGuardianToken();
  if (!token) return false;
  const data = await call({ action: 'account_claim', token });
  await saveToken(data.link_id, token);
  return true;
}

export async function listAccountGuardians() {
  // Someone may have joined with a code before creating their own account.
  // Claim that same device token so their connection follows the new account.
  await claimGuestGuardianConnection().catch(() => {});
  const data = await call({ action: 'account_list' });
  return data.links || [];
}

export async function linkAccountWithCode(code, name) {
  const data = await call({
    action: 'account_link', code: String(code || '').replace(/\D/g, ''),
    name: name.trim(), label: deviceLabel(), platform: platformTag(),
  });
  await saveToken(data.link_id, data.token);
  return { id: data.link_id, name: data.patient?.name };
}

export async function addAccountGuardianDevice(linkId) {
  const data = await call({ action: 'account_device', link_id: linkId, label: deviceLabel(), platform: platformTag() });
  await saveToken(data.link_id, data.token);
  return data.link_id;
}

export async function fetchAccountDashboard(linkId) {
  const data = await call({ action: 'account_dashboard', link_id: linkId });
  return { data, cached: false, at: Date.now() };
}

export async function unlinkAccountGuardian(linkId) {
  return call({ action: 'account_unlink', link_id: linkId });
}
