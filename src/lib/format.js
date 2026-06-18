// Date / time helpers shared across the app.
export function deviceTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch { return 'UTC'; }
}

// 'YYYY-MM-DD' for today (or a given date) in a timezone.
export function localDateStr(tz = deviceTimezone(), date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
}

export function prettyTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function prettyClock(d) {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// '2026-06-18' -> 'Thursday, June 18'
export function prettyDate(isoDate) {
  if (!isoDate) return '';
  const [y, mo, d] = isoDate.split('-').map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

// '2026-06-18' -> 'Jun 18'
export function shortDate(isoDate) {
  if (!isoDate) return '';
  const [y, mo, d] = isoDate.split('-').map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function ageFromBirthday(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const b = new Date(y, m - 1, d);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const mm = now.getMonth() - b.getMonth();
  if (mm < 0 || (mm === 0 && now.getDate() < b.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

export function initials(name) {
  if (!name) return 'M';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || 'M';
}

export function relativeTime(iso) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const day = 86400000;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
  if (diff < day) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (diff < 2 * day) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
