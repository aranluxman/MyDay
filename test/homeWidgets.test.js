// The customizable Home: saved layouts stay valid as widgets come and go.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WIDGETS, DEFAULT_LAYOUT, normalizeLayout, moveWidget, toggleWidget, todaysMood, MOODS } from '../src/lib/homeWidgets.js';

test('nothing saved means every widget at its default', () => {
  assert.deepEqual(normalizeLayout(null), DEFAULT_LAYOUT);
  assert.deepEqual(normalizeLayout('junk'), DEFAULT_LAYOUT);
  assert.equal(normalizeLayout(null).find((w) => w.id === 'visitHistory').on, false);
});

test('saved order and choices are kept; unknown and repeated ids dropped; new widgets added', () => {
  const saved = [{ id: 'week', on: false }, { id: 'retired' }, { id: 'today', on: true }, { id: 'week', on: true }];
  const out = normalizeLayout(saved);
  assert.equal(out.length, WIDGETS.length);
  assert.deepEqual(out.slice(0, 1), [{ id: 'feeling', on: true }]); // new, at its default spot
  assert.ok(out.findIndex((w) => w.id === 'week') < out.findIndex((w) => w.id === 'today'));
  assert.equal(out.find((w) => w.id === 'week').on, false);
  assert.equal(new Set(out.map((w) => w.id)).size, out.length);
});

test('moving and toggling', () => {
  const l = normalizeLayout(null);
  const up = moveWidget(l, l[1].id, -1);
  assert.equal(up[0].id, l[1].id);
  assert.equal(moveWidget(l, l[0].id, -1), l); // already first
  assert.equal(moveWidget(l, 'nope', 1), l);
  assert.equal(toggleWidget(l, 'today', false).find((w) => w.id === 'today').on, false);
  assert.equal(toggleWidget(l, 'today').find((w) => w.id === 'today').on, false);
});

test('today’s mood comes from a diary entry written today', () => {
  const dayOf = (iso) => iso.slice(0, 10);
  const entries = [
    { title: 'Headache', entry_at: '2026-10-07T09:00:00Z' },
    { title: 'Feeling okay', entry_at: '2026-10-07T08:00:00Z' },
    { title: 'Feeling great', entry_at: '2026-10-06T08:00:00Z' },
  ];
  assert.equal(todaysMood(entries, '2026-10-07', dayOf).mood.id, 'okay');
  assert.equal(todaysMood(entries, '2026-10-08', dayOf), null);
  assert.ok(MOODS.every((m) => ['other', 'symptom'].includes(m.category)));
});
