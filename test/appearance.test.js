// Profile progress: a brand-new account starts at a third, not near zero.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profileCompleteness } from '../src/lib/appearance.js';

test('a brand-new profile starts at 33%', () => {
  assert.equal(profileCompleteness({ full_name: 'Mary', for_whom: 'self' }).pct, 33);
  assert.equal(profileCompleteness(null).pct, 33);
  assert.equal(profileCompleteness({}).pct, 33);
});

test('each extra item adds its share of the remaining two thirds', () => {
  const p = { full_name: 'Mary', for_whom: 'self', birthday: '1950-05-05', goal: 'Walk daily' };
  assert.equal(profileCompleteness(p).pct, 67);
});

test('everything filled is 100%, and the checklist is empty', () => {
  const r = profileCompleteness({ full_name: 'Mary', for_whom: 'self', avatar_url: 'x', birthday: '1950-05-05', on_treatment: 'Metformin', goal: 'Walk' });
  assert.equal(r.pct, 100);
  assert.deepEqual(r.missing, []);
});

test('all extras but a missing name stays under 100 and lists the name', () => {
  const r = profileCompleteness({ for_whom: 'self', avatar_url: 'x', birthday: '1950-05-05', on_treatment: 'M', goal: 'W' });
  assert.equal(r.pct, 99);
  assert.ok(r.missing.includes('full_name'));
});
