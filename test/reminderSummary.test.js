import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reminderSummary } from '../src/lib/readiness.js';
import { deliveryStatus } from '../src/lib/notifications.js';

const on = { master: true, dose_due: true };
const ready = deliveryStatus({ supported: true, permission: 'granted', installed: true, platform: 'desktop' });

test('three separate answers: MyDay setting, this device, and a test the person saw', () => {
  const s = reminderSummary({ prefs: on, status: ready, testSeenAt: '2026-10-07T13:00:00Z' });
  assert.deepEqual(s.lines.map((l) => [l.id, l.value, l.state]), [
    ['pref', 'On', 'ok'], ['device', 'Allowed', 'ok'], ['test', 'Seen', 'ok'],
  ]);
  assert.equal(s.next, null);
});

test('allowed but never checked: the next step is a test, not a claim it works', () => {
  const s = reminderSummary({ prefs: on, status: ready });
  assert.equal(s.lines[2].value, 'Not checked');
  assert.deepEqual(s.next, { label: 'Send a test alert', reason: 'test' });
});

test('the device problem comes first, with words for each kind', () => {
  const ipad = deliveryStatus({ supported: true, permission: 'default', installed: false, platform: 'ipados' });
  assert.equal(reminderSummary({ prefs: on, status: ipad }).lines[1].value, 'Needs MyDay on the home screen');
  assert.equal(reminderSummary({ prefs: on, status: ipad }).next.label, 'How to add MyDay to the home screen');
  const blocked = deliveryStatus({ supported: true, permission: 'denied', installed: true, platform: 'desktop' });
  assert.equal(reminderSummary({ prefs: on, status: blocked }).lines[1].state, 'warn');
  const fresh = deliveryStatus({ supported: true, permission: 'default', installed: true, platform: 'desktop' });
  assert.equal(reminderSummary({ prefs: on, status: fresh }).next.label, 'Turn on alerts for this device');
});

test('reminders off in MyDay: says Off, and offers no device step (the switch is the fix)', () => {
  const s = reminderSummary({ prefs: { master: true, dose_due: false }, status: ready });
  assert.equal(s.prefOn, false);
  assert.equal(s.lines[0].value, 'Off');
  assert.equal(s.next, null);
  assert.equal(reminderSummary({ prefs: { master: false }, status: ready }).prefOn, false);
});
