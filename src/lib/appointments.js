// Appointment helpers: the countdown wording, grouping past from upcoming,
// and the .ics export. Pure, so the wording and the escaping are tested.

/** Whole days from today to an appointment date, in local time. */
export function daysUntil(isoDate, now = new Date()) {
  if (!isoDate) return null;
  const [y, m, d] = String(isoDate).split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const then = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((then - today) / 86400000);
}

/**
 * "in 3 days" / "Tomorrow" / "Today" / "2 weeks ago".
 * Deliberately vague past a fortnight: nobody plans around "in 23 days".
 */
export function countdownLabel(isoDate, now = new Date()) {
  const days = daysUntil(isoDate, now);
  if (days == null) return '';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days < 0) {
    const ago = Math.abs(days);
    if (ago < 7) return `${ago} days ago`;
    if (ago < 14) return 'Last week';
    if (ago < 60) return `${Math.round(ago / 7)} weeks ago`;
    return `${Math.round(ago / 30)} months ago`;
  }
  if (days < 7) return `In ${days} days`;
  if (days < 14) return 'Next week';
  if (days < 60) return `In ${Math.round(days / 7)} weeks`;
  return `In ${Math.round(days / 30)} months`;
}

/** Upcoming (today onwards) and past, each in the order a person would read. */
export function groupAppointments(list, now = new Date()) {
  const upcoming = [];
  const past = [];
  for (const a of list || []) {
    const days = daysUntil(a.appt_date, now);
    (days != null && days < 0 ? past : upcoming).push(a);
  }
  const byDate = (dir) => (a, b) =>
    dir * (String(a.appt_date).localeCompare(String(b.appt_date))
      || String(a.appt_time || '').localeCompare(String(b.appt_time || '')));
  upcoming.sort(byDate(1));   // soonest first
  past.sort(byDate(-1));      // most recent first
  return { upcoming, past };
}

/** A maps link for the address, which is what "directions" actually means. */
export function directionsUrl(location) {
  const q = String(location || '').trim();
  if (!q) return null;
  return `https://maps.google.com/?q=${encodeURIComponent(q)}`;
}

/** Digits only, so a number written "(555) 123-4567" still dials. */
export function telHref(phone) {
  const cleaned = String(phone || '').replace(/[^\d+]/g, '');
  return cleaned ? `tel:${cleaned}` : null;
}

// ---------- calendar export (.ics) ----------

/**
 * RFC 5545 escaping. A comma, semicolon or backslash in a clinic name would
 * otherwise split the field and produce a file the calendar app rejects.
 */
export function icsEscape(text) {
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

const pad = (n) => String(n).padStart(2, '0');

/** Local date-time in the form iCalendar wants for a floating time. */
function icsLocal(isoDate, time) {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!time) return `${y}${pad(m)}${pad(d)}`;
  const [hh, mm] = time.split(':').map(Number);
  return `${y}${pad(m)}${pad(d)}T${pad(hh)}${pad(mm)}00`;
}

function addHour(isoDate, time) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const end = new Date(y, m - 1, d, hh + 1, mm);
  return `${end.getFullYear()}${pad(end.getMonth() + 1)}${pad(end.getDate())}`
    + `T${pad(end.getHours())}${pad(end.getMinutes())}00`;
}

/**
 * One appointment as an .ics file body.
 *
 * Times are FLOATING (no timezone, no Z): an appointment at 10:30 is at 10:30
 * wherever the person is, and converting it to UTC is how a calendar entry
 * ends up an hour out after a daylight-saving change.
 */
export function buildIcs(appt, { now = new Date() } = {}) {
  if (!appt?.appt_date) return null;
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`
    + `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  const title = appt.doctor_name || appt.reason || 'Appointment';
  const start = icsLocal(appt.appt_date, appt.appt_time);
  const allDay = !appt.appt_time;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MyDay//Appointments//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:myday-${appt.id || start}@myday`,
    `DTSTAMP:${stamp}`,
    allDay ? `DTSTART;VALUE=DATE:${start}` : `DTSTART:${start}`,
    allDay ? `DTEND;VALUE=DATE:${start}` : `DTEND:${addHour(appt.appt_date, appt.appt_time)}`,
    `SUMMARY:${icsEscape(title)}`,
  ];
  if (appt.location) lines.push(`LOCATION:${icsEscape(appt.location)}`);
  if (appt.reason && appt.doctor_name) lines.push(`DESCRIPTION:${icsEscape(appt.reason)}`);
  // A reminder the calendar itself will fire, independent of MyDay.
  lines.push('BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape(title)}`, 'END:VALARM');
  lines.push('END:VEVENT', 'END:VCALENDAR');

  // CRLF is required by the spec; some calendar apps reject bare newlines.
  return lines.join('\r\n');
}

/** Filename a person will recognise in their downloads. */
export function icsFilename(appt) {
  const name = (appt?.doctor_name || appt?.reason || 'appointment')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `myday-${name || 'appointment'}-${appt?.appt_date || ''}.ics`;
}
