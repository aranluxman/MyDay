// Today's medicine groups and safe text at the rendering boundary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupDoses } from '../src/lib/homeWidgets.js';
import { present } from '../src/lib/format.js';

test('doses group into morning, afternoon, evening and when-needed, in time order', () => {
  const d = (id, t, extra = {}) => ({ id, scheduled_time: t, ...extra });
  const groups = groupDoses([d('c', '20:00'), d('a', '08:00'), d('b', '12:00'), d('x', '07:30'), d('p', '10:15', { as_needed: true }), d('e', '16:59')]);
  assert.deepEqual(groups.map((g) => g.id), ['morning', 'afternoon', 'evening', 'prn']);
  assert.deepEqual(groups[0].doses.map((x) => x.id), ['x', 'a']);
  assert.deepEqual(groups[1].doses.map((x) => x.id), ['b', 'e']);
  assert.deepEqual(groups[2].doses.map((x) => x.id), ['c']);
  assert.deepEqual(groups[3].doses.map((x) => x.id), ['p']);
});

test('empty groups are left out, and nothing in gives nothing out', () => {
  assert.deepEqual(groupDoses([{ id: 'a', scheduled_time: '21:00' }]).map((g) => g.id), ['evening']);
  assert.deepEqual(groupDoses(null), []);
});

test('present() never lets null or undefined reach the screen', () => {
  assert.equal(present(null), '');
  assert.equal(present(undefined), '');
  assert.equal(present('null'), '');
  assert.equal(present(' undefined '), '');
  assert.equal(present('  Headache  '), 'Headache');
  assert.equal(present(0), '0');
});
