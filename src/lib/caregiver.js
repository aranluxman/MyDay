// What the caregiver overview says about one person, from the read-only
// dashboard the server returns. Pure, tested in test/caregiver.test.js.
//
// The words matter here: MyDay only knows whether a dose has a RECORD. A dose
// with no record is "not recorded" (window passed) or "not recorded yet"
// (still inside its window). It is never called missed or not taken.
import { doseState } from './doseState.js';

/**
 * @param {object|null} data  a guardian dashboard payload, or null if it could not load
 * @param {{now?: number}} [o]
 */
export function summarisePerson(data, o = {}) {
  const empty = { loaded: false, total: 0, settled: 0, taken: 0, skipped: 0, open: 0, unrecorded: [], nextAppointment: null };
  if (!data) return empty;
  const opts = { windowMinutes: data.patient?.alert_window_minutes ?? 60, now: o.now };
  const doses = (data.today?.doses || []).filter((d) => !d.as_needed);
  let taken = 0; let skipped = 0; let open = 0;
  const unrecorded = [];
  for (const d of doses) {
    const st = doseState(d, opts);
    if (st === 'taken') taken += 1;
    else if (st === 'skipped') skipped += 1;
    else if (st === 'missed' || st === 'overdue') {
      unrecorded.push({ id: d.id, name: d.medication?.name || 'Medicine', time: d.scheduled_time, state: st });
    } else open += 1;
  }
  unrecorded.sort((a, b) => String(a.time).localeCompare(String(b.time)));
  const appt = (data.appointments || [])[0] || null;
  return {
    loaded: true,
    total: doses.length,
    taken, skipped, open,
    // "Recorded" = has a record of any kind: taken or deliberately "Not today".
    settled: taken + skipped,
    unrecorded,
    nextAppointment: appt ? {
      who: appt.doctor_name || appt.reason || 'Appointment',
      when: apptWhen(appt, data.today?.date),
    } : null,
  };
}

/** Does this person have a dose with no record that is worth a check-in? */
export function needsCheckIn(sum) { return !!sum?.loaded && sum.unrecorded.length > 0; }

function apptWhen(appt, todayIso) {
  const d = new Date(`${appt.appt_date}T00:00:00`);
  let day = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  if (todayIso) {
    const diff = Math.round((d - new Date(`${todayIso}T00:00:00`)) / 86400000);
    if (diff === 0) day = 'Today'; else if (diff === 1) day = 'Tomorrow';
  }
  if (!appt.appt_time) return day;
  const [h, m] = String(appt.appt_time).split(':').map(Number);
  const t = new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${day}, ${t}`;
}
