import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  daysUntil, countdownLabel, groupAppointments, directionsUrl, telHref,
  icsEscape, buildIcs, icsFilename,
} from '../src/lib/appointments.js';

const NOW = new Date('2026-09-18T12:00:00');

test('day counting is whole days, not hours', () => {
  assert.equal(daysUntil('2026-09-18', NOW), 0);
  assert.equal(daysUntil('2026-09-19', NOW), 1);
  assert.equal(daysUntil('2026-09-17', NOW), -1);
  assert.equal(daysUntil('2026-09-25', NOW), 7);
  // A late-evening "now" must not make tomorrow look like today.
  assert.equal(daysUntil('2026-09-19', new Date('2026-09-18T23:30:00')), 1);
  assert.equal(daysUntil(null, NOW), null);
  assert.equal(daysUntil('nonsense', NOW), null);
});

test('the countdown reads the way a person would say it', () => {
  assert.equal(countdownLabel('2026-09-18', NOW), 'Today');
  assert.equal(countdownLabel('2026-09-19', NOW), 'Tomorrow');
  assert.equal(countdownLabel('2026-09-21', NOW), 'In 3 days');
  assert.equal(countdownLabel('2026-09-27', NOW), 'Next week');
  assert.equal(countdownLabel('2026-10-16', NOW), 'In 4 weeks');
  assert.equal(countdownLabel('2026-09-17', NOW), 'Yesterday');
  assert.equal(countdownLabel('2026-09-14', NOW), '4 days ago');
});

test('appointments split into upcoming and past, each in reading order', () => {
  const list = [
    { id: 'a', appt_date: '2026-09-25' },
    { id: 'b', appt_date: '2026-09-10' },
    { id: 'c', appt_date: '2026-09-18' },
    { id: 'd', appt_date: '2026-09-15' },
    { id: 'e', appt_date: '2026-09-20' },
  ];
  const { upcoming, past } = groupAppointments(list, NOW);
  assert.deepEqual(upcoming.map((a) => a.id), ['c', 'e', 'a'], 'soonest first, today counts as upcoming');
  assert.deepEqual(past.map((a) => a.id), ['d', 'b'], 'most recent first');
  assert.deepEqual(groupAppointments([], NOW), { upcoming: [], past: [] });
  assert.deepEqual(groupAppointments(null, NOW), { upcoming: [], past: [] });
});

test('same-day appointments order by time', () => {
  const { upcoming } = groupAppointments([
    { id: 'late', appt_date: '2026-09-20', appt_time: '15:00' },
    { id: 'early', appt_date: '2026-09-20', appt_time: '09:00' },
  ], NOW);
  assert.deepEqual(upcoming.map((a) => a.id), ['early', 'late']);
});

test('directions and dialling handle messy input', () => {
  assert.match(directionsUrl('22 Main St, Markham'), /^https:\/\/maps\.google\.com\/\?q=22%20Main/);
  assert.equal(directionsUrl(''), null);
  assert.equal(directionsUrl(null), null);
  assert.equal(telHref('(555) 123-4567'), 'tel:5551234567');
  assert.equal(telHref('+1 555 123 4567'), 'tel:+15551234567');
  assert.equal(telHref('no digits here'), null);
  assert.equal(telHref(''), null);
});

test('ics escaping protects the characters that break the format', () => {
  // A clinic called "Smith, Jones & Co; Suite 2" would otherwise split fields.
  assert.equal(icsEscape('Smith, Jones; Suite 2'), 'Smith\\, Jones\\; Suite 2');
  assert.equal(icsEscape('back\\slash'), 'back\\\\slash');
  assert.equal(icsEscape('line one\nline two'), 'line one\\nline two');
  assert.equal(icsEscape(null), '');
});

test('a timed appointment exports as a floating-time event', () => {
  const ics = buildIcs({ id: 'x1', appt_date: '2026-09-20', appt_time: '10:30',
    doctor_name: 'Dr. Patel', location: 'Riverside Clinic', reason: 'Check-up' }, { now: NOW });

  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /DTSTART:20260920T103000/);
  assert.match(ics, /DTEND:20260920T113000/, 'defaults to one hour');
  assert.match(ics, /SUMMARY:Dr\. Patel/);
  assert.match(ics, /LOCATION:Riverside Clinic/);
  assert.match(ics, /BEGIN:VALARM/, 'the calendar gets its own reminder');
  // Floating time: no trailing Z on DTSTART, or a DST change shifts the visit.
  assert.ok(!/DTSTART:\d+T\d+Z/.test(ics), 'must not be converted to UTC');
  assert.ok(ics.includes('\r\n'), 'CRLF line endings are required');
});

test('an all-day appointment exports as a date, not a midnight time', () => {
  const ics = buildIcs({ id: 'x2', appt_date: '2026-09-20', reason: 'Flu shot' }, { now: NOW });
  assert.match(ics, /DTSTART;VALUE=DATE:20260920/);
  assert.ok(!/T000000/.test(ics), 'an all-day visit is not at midnight');
  assert.match(ics, /SUMMARY:Flu shot/);
});

test('an appointment with no date exports nothing', () => {
  assert.equal(buildIcs({}), null);
  assert.equal(buildIcs(null), null);
});

test('the filename is recognisable and safe', () => {
  assert.equal(icsFilename({ doctor_name: 'Dr. Patel', appt_date: '2026-09-20' }), 'myday-dr-patel-2026-09-20.ics');
  assert.equal(icsFilename({ reason: 'Blood test', appt_date: '2026-09-20' }), 'myday-blood-test-2026-09-20.ics');
  assert.match(icsFilename({}), /^myday-appointment-\.ics$/);
});
