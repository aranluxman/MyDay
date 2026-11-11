import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarisePerson, needsCheckIn } from '../src/lib/caregiver.js';

const NOW = Date.parse('2026-11-10T15:00:00Z');
const dose = (id, time, status, extra = {}) => ({ id, scheduled_time: time, due_at: `2026-11-10T${time}:00Z`, status, medication: { name: `Med ${id}` }, ...extra });

test('a dashboard that could not load is never summarised as fine', () => {
  const s = summarisePerson(null);
  assert.equal(s.loaded, false);
  assert.equal(needsCheckIn(s), false);
  assert.equal(s.total, 0);
});

test('records are counted; a missing record is "unrecorded", never anything stronger', () => {
  const data = {
    patient: { alert_window_minutes: 60 },
    today: { date: '2026-11-10', doses: [
      dose('a', '08:00', 'taken'),
      dose('b', '09:00', 'skipped'),
      dose('c', '10:00', 'pending'),          // window long passed
      dose('d', '14:30', 'pending'),          // due 30 min ago, inside the window
      dose('e', '21:00', 'pending'),          // tonight
      dose('f', '12:00', 'taken', { as_needed: true }),
    ] },
    appointments: [{ appt_date: '2026-11-11', appt_time: '10:30', doctor_name: 'Dr. Synthetic' }],
  };
  const s = summarisePerson(data, { now: NOW });
  assert.equal(s.total, 5);
  assert.equal(s.settled, 2);
  assert.equal(s.open, 1);
  assert.deepEqual(s.unrecorded.map((u) => [u.id, u.state]), [['c', 'missed'], ['d', 'overdue']]);
  assert.equal(needsCheckIn(s), true);
  assert.equal(s.nextAppointment.who, 'Dr. Synthetic');
  assert.match(s.nextAppointment.when, /^Tomorrow, /);
});

test('everything recorded: no check-in, and no appointment is reported as none', () => {
  const s = summarisePerson({ today: { date: '2026-11-10', doses: [dose('a', '08:00', 'taken')] }, appointments: [] }, { now: NOW });
  assert.equal(needsCheckIn(s), false);
  assert.equal(s.settled, 1);
  assert.equal(s.nextAppointment, null);
});
