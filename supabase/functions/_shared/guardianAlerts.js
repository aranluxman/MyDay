import { localHHMM, minutesOfDay } from './notificationRules.js';

export const GUARDIAN_DELAYS = [15, 30, 45, 60];

// Guardian timing is independent of the patient's own grace period. Pending
// doses can therefore qualify before the patient labels the dose "missed".
export function guardianAlertDue(dose, device, { now = Date.now(), timezone = 'UTC' } = {}) {
  if (!['pending', 'missed'].includes(dose?.status) || dose.taken_at || dose.as_needed) return false;
  if (dose.medication?.reminders_enabled === false || dose.medication?.active === false) return false;
  const due = Date.parse(dose.due_at);
  if (!Number.isFinite(due) || due >= now) return false;
  if (device.alert_mode !== 'time') {
    const delay = GUARDIAN_DELAYS.includes(device.alert_delay_minutes) ? device.alert_delay_minutes : 60;
    return now >= due + delay * 60_000;
  }
  if (minutesOfDay(device.alert_at) == null) return false;
  // Compare wall dates and clocks in the medication owner's timezone so DST
  // days do not get treated as a fixed number of elapsed hours.
  const wallDate = (at) => new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(at));
  try {
    let checkDay = wallDate(due);
    if (device.alert_at <= localHHMM(new Date(due), timezone)) {
      checkDay = new Date(Date.parse(`${checkDay}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
    }
    const today = wallDate(now);
    return today > checkDay || (today === checkDay && localHHMM(new Date(now), timezone) >= device.alert_at);
  } catch { return false; }
}

export function guardianDeliveryKey(deviceId, doseId) {
  return `guardian_missed:${deviceId}:${doseId}`;
}
