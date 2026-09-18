// Health card wallet.
//
// The rules that matter here are about NOT doing things: no OCR, no
// extraction, nothing sent anywhere, no guardian access, and a card number
// masked until the person deliberately reveals it. The pure helpers below are
// tested; the Supabase calls are thin.
import { supabase } from './supabase.js';
import { compressImage } from './db.js';

export const CARD_TYPES = [
  { id: 'health', label: 'Health card', icon: 'cross' },
  { id: 'insurance', label: 'Insurance', icon: 'shield' },
  { id: 'pharmacy', label: 'Pharmacy', icon: 'pill' },
  { id: 'id', label: 'ID', icon: 'user' },
  { id: 'benefits', label: 'Benefits', icon: 'star' },
  { id: 'other', label: 'Other', icon: 'notes' },
];

const TYPE_LABEL = Object.fromEntries(CARD_TYPES.map((t) => [t.id, t.label]));
export const cardTypeLabel = (id) => TYPE_LABEL[id] || 'Card';

/**
 * Masks a card number for display, showing only the last four characters.
 *
 * Deliberately preserves the original grouping so a masked number still looks
 * like the card it came from ("1234 567 890" -> "•••• ••• 890"), which is what
 * lets someone confirm they picked the right card without revealing it.
 * Separators are kept; everything else becomes a bullet.
 */
export function maskCardNumber(value, visible = 4) {
  const raw = String(value ?? '');
  if (!raw.trim()) return '';

  // Count back `visible` alphanumeric characters from the end.
  let seen = 0;
  let revealFrom = raw.length;
  for (let i = raw.length - 1; i >= 0; i--) {
    if (/[a-z0-9]/i.test(raw[i])) {
      seen++;
      if (seen === visible) { revealFrom = i; break; }
    }
  }
  // A number shorter than the reveal window is masked completely rather than
  // shown in full — the whole point is that a glance does not leak it.
  if (seen < visible) return raw.replace(/[a-z0-9]/gi, '•');

  return raw
    .split('')
    .map((ch, i) => (i >= revealFrom || !/[a-z0-9]/i.test(ch) ? ch : '•'))
    .join('');
}

/** 'Expires 06/2027' style text, or null when there is nothing useful to say. */
export function expiryLabel(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  return `Expires ${raw}`;
}

/** True when an expiry that parses as a month or date has already passed. */
export function isExpired(value, now = new Date()) {
  const raw = String(value ?? '').trim();
  if (!raw) return false;
  // Accept YYYY-MM, YYYY-MM-DD, MM/YYYY and MM/YY.
  let y; let m; let d = null;
  let match;
  if ((match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(raw))) {
    y = +match[1]; m = +match[2]; d = match[3] ? +match[3] : null;
  } else if ((match = /^(\d{1,2})\/(\d{4})$/.exec(raw))) {
    m = +match[1]; y = +match[2];
  } else if ((match = /^(\d{1,2})\/(\d{2})$/.exec(raw))) {
    m = +match[1]; y = 2000 + +match[2];
  } else {
    return false; // unparseable: never claim a card has expired on a guess
  }
  if (!(m >= 1 && m <= 12)) return false;
  // A month with no day means the card is good to the END of that month.
  const end = d ? new Date(y, m - 1, d, 23, 59, 59) : new Date(y, m, 0, 23, 59, 59);
  return end.getTime() < now.getTime();
}

/** Puts cards in the order the person arranged them. */
export function sortCards(cards) {
  return [...(cards || [])].sort((a, b) =>
    (a.sort_order ?? 0) - (b.sort_order ?? 0)
    || String(a.created_at || '').localeCompare(String(b.created_at || '')));
}

/** New sort_order for a card moved from index `from` to index `to`. */
export function reorder(cards, from, to) {
  const list = sortCards(cards);
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next.map((c, i) => ({ ...c, sort_order: i }));
}

/* ------------------------------- data ------------------------------- */

const COLS = 'id,label,card_type,card_number,expiry,note,front_path,back_path,sort_order,created_at';

export async function listCards() {
  const { data, error } = await supabase.from('myday_health_cards')
    .select(COLS).order('sort_order').order('created_at');
  if (error) throw error;
  return data || [];
}

export async function saveCard(card) {
  const row = {
    label: String(card.label || '').trim(),
    card_type: card.card_type || 'other',
    card_number: card.card_number?.trim() || null,
    expiry: card.expiry?.trim() || null,
    note: card.note?.trim() || null,
    front_path: card.front_path ?? null,
    back_path: card.back_path ?? null,
    sort_order: card.sort_order ?? 0,
  };
  if (card.id) {
    const { error } = await supabase.from('myday_health_cards').update(row).eq('id', card.id);
    if (error) throw error;
    return card.id;
  }
  const { data, error } = await supabase.from('myday_health_cards').insert(row).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function persistOrder(cards) {
  // One update per card; the list is short enough that a batch is not worth
  // the complexity, and a partial failure just leaves the old order.
  await Promise.all((cards || []).map((c, i) =>
    supabase.from('myday_health_cards').update({ sort_order: i }).eq('id', c.id)));
}

/** Deletes the row AND its stored images — a card must not leave files behind. */
export async function deleteCard(card) {
  const paths = [card.front_path, card.back_path].filter(Boolean);
  if (paths.length) {
    // Remove the files first: a failed row delete leaves orphaned images,
    // which is worse than a failed file delete leaving an unreferenced row.
    await supabase.storage.from('myday-cards').remove(paths);
  }
  const { error } = await supabase.from('myday_health_cards').delete().eq('id', card.id);
  if (error) throw error;
}

/** Uploads one side of a card. Compressed in the browser before it leaves. */
export async function uploadCardImage(file, onProgress) {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) throw new Error('You have been signed out. Please sign in again.');

  onProgress?.(0.15);
  const blob = await compressImage(file, 1600, 0.85);
  onProgress?.(0.45);
  const path = `${userId}/${crypto.randomUUID()}.webp`;
  const { error } = await supabase.storage.from('myday-cards')
    .upload(path, blob, { contentType: 'image/webp', upsert: false });
  if (error) throw error;
  onProgress?.(1);
  return path;
}

export async function removeCardImage(path) {
  if (!path) return;
  await supabase.storage.from('myday-cards').remove([path]);
}

// Signed URLs are short-lived, so they are cached in memory for a little less
// than their lifetime. Without this, opening a card re-signs on every render.
const SIGNED_TTL = 3600;
const signedCache = new Map();

export async function cardImageUrl(path, { refresh = false } = {}) {
  if (!path) return null;
  const hit = signedCache.get(path);
  if (!refresh && hit && hit.expires > Date.now()) return hit.url;

  const { data, error } = await supabase.storage.from('myday-cards')
    .createSignedUrl(path, SIGNED_TTL);
  if (error || !data?.signedUrl) return null;

  signedCache.set(path, { url: data.signedUrl, expires: Date.now() + (SIGNED_TTL - 120) * 1000 });
  return data.signedUrl;
}

/**
 * Asks the service worker to keep these card images offline.
 *
 * This is the point of the whole feature: a card has to open in a clinic
 * basement with no signal. The signed URL expires, so the SW caches the
 * RESPONSE BODY under a stable key derived from the storage path rather than
 * the URL, and serves it back whenever the network fails.
 */
export async function cacheCardsOffline(cards) {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  if (!reg?.active) return;

  const items = [];
  for (const c of cards || []) {
    for (const path of [c.front_path, c.back_path].filter(Boolean)) {
      const url = await cardImageUrl(path);
      if (url) items.push({ path, url });
    }
  }
  if (items.length) reg.active.postMessage({ type: 'myday-cache-cards', items });
}

/** Offline fallback: the cached copy of a card image, as a blob URL. */
export async function offlineCardImage(path) {
  try {
    const cache = await caches.open('myday-cards-v1');
    const hit = await cache.match(cardCacheKey(path));
    if (!hit) return null;
    return URL.createObjectURL(await hit.blob());
  } catch { return null; }
}

/** Stable cache key for a card image, independent of the signed URL. */
export function cardCacheKey(path) {
  return `https://myday.local/card-image/${encodeURIComponent(path)}`;
}
