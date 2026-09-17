// Guardian access scoping. These are the tests that matter most in Part A:
// a guardian device must reach exactly one senior's data, read-only, and lose
// access the instant it is revoked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeDevice, authorizeCode, visibleTables, looksLikeToken, normaliseCode,
  GUARDIAN_WRITE_CAPABILITIES, CODE_TTL_MINUTES,
} from '../supabase/functions/_shared/guardianAccess.js';

const NOW = Date.parse('2026-09-17T12:00:00Z');
const at = (mins) => new Date(NOW + mins * 60_000).toISOString();

const SENIOR = '11111111-1111-1111-1111-111111111111';
const OTHER_SENIOR = '22222222-2222-2222-2222-222222222222';

const guardian = (over = {}) => ({
  id: 'g-1', user_id: SENIOR, name: 'Sarah', status: 'active', share_diary: false, ...over,
});
const device = (over = {}) => ({
  id: 'd-1', guardian_id: 'g-1', revoked_at: null, label: 'Sarah’s iPad', ...over,
});

// ---------------------------------------------------------------- device token

test('a live device reads exactly the one senior it is linked to', () => {
  const v = authorizeDevice({ device: device(), guardian: guardian(), now: NOW });
  assert.equal(v.ok, true);
  assert.equal(v.userId, SENIOR);
  assert.notEqual(v.userId, OTHER_SENIOR);
});

test('a revoked device is refused immediately', () => {
  const v = authorizeDevice({ device: device({ revoked_at: at(-1) }), guardian: guardian(), now: NOW });
  assert.equal(v.ok, false);
  assert.equal(v.status, 401);
  assert.equal(v.code, 'unlinked');
});

test('revocation takes effect at its timestamp, not a minute later', () => {
  // Exactly now counts as revoked — the senior tapped Revoke, it is gone.
  assert.equal(authorizeDevice({ device: device({ revoked_at: at(0) }), guardian: guardian(), now: NOW }).ok, false);
  // A future timestamp is not yet in force.
  assert.equal(authorizeDevice({ device: device({ revoked_at: at(5) }), guardian: guardian(), now: NOW }).ok, true);
});

test('revoking the whole guardian kills every one of their devices', () => {
  const v = authorizeDevice({ device: device(), guardian: guardian({ status: 'revoked' }), now: NOW });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'unlinked');
});

test('an unknown token is refused', () => {
  assert.equal(authorizeDevice({ device: null, guardian: guardian(), now: NOW }).ok, false);
});

test('a device whose guardian row is missing is refused, never allowed by default', () => {
  assert.equal(authorizeDevice({ device: device(), guardian: null, now: NOW }).ok, false);
});

test('a device cannot be paired with a guardian row it does not belong to', () => {
  // The case that would let one device read another senior: a mismatched join.
  const v = authorizeDevice({
    device: device({ guardian_id: 'g-1' }),
    guardian: guardian({ id: 'g-2', user_id: OTHER_SENIOR }),
    now: NOW,
  });
  assert.equal(v.ok, false, 'mismatched guardian_id must not authorize');
});

test('a guardian row with no senior authorizes nothing', () => {
  const v = authorizeDevice({ device: device(), guardian: guardian({ user_id: null }), now: NOW });
  assert.equal(v.ok, false);
});

test('unknown and revoked tokens are indistinguishable to the caller', () => {
  const unknown = authorizeDevice({ device: null, guardian: null, now: NOW });
  const revoked = authorizeDevice({ device: device({ revoked_at: at(-10) }), guardian: guardian(), now: NOW });
  assert.equal(unknown.message, revoked.message);
  assert.equal(unknown.status, revoked.status);
});

// ----------------------------------------------------------------- linking code

test('a fresh unused code links', () => {
  const v = authorizeCode({ guardian: guardian({ code_expires_at: at(10), code_used_at: null }), now: NOW });
  assert.equal(v.ok, true);
  assert.equal(v.userId, SENIOR);
});

test('a code is single-use', () => {
  const v = authorizeCode({
    guardian: guardian({ code_expires_at: at(10), code_used_at: at(-2) }), now: NOW,
  });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'code_used');
  assert.equal(v.status, 410);
});

test('a code expires', () => {
  const v = authorizeCode({ guardian: guardian({ code_expires_at: at(-1) }), now: NOW });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'code_expired');
  assert.match(v.message, new RegExp(`${CODE_TTL_MINUTES} minutes`));
});

test('a code with no expiry is treated as expired, never as forever', () => {
  // Rows created before 0008 have no code_expires_at. They must not be
  // permanently valid credentials.
  for (const bad of [null, undefined, '', 'nonsense']) {
    const v = authorizeCode({ guardian: guardian({ code_expires_at: bad }), now: NOW });
    assert.equal(v.ok, false, `expiry ${JSON.stringify(bad)} must not authorize`);
    assert.equal(v.code, 'code_expired');
  }
});

test('an unknown or revoked code is refused', () => {
  assert.equal(authorizeCode({ guardian: null, now: NOW }).status, 404);
  assert.equal(authorizeCode({ guardian: guardian({ status: 'revoked' }), now: NOW }).status, 404);
});

// ------------------------------------------------------------------ capabilities

test('a guardian never has a write capability', () => {
  assert.deepEqual(GUARDIAN_WRITE_CAPABILITIES, []);
  const viaToken = authorizeDevice({ device: device(), guardian: guardian(), now: NOW });
  const viaCode = authorizeCode({ guardian: guardian({ code_expires_at: at(5) }), now: NOW });
  assert.deepEqual(viaToken.writes, []);
  assert.deepEqual(viaCode.writes, []);
});

test('the write capability list cannot be mutated through a returned verdict', () => {
  const v = authorizeDevice({ device: device(), guardian: guardian(), now: NOW });
  v.writes.push('doses');
  assert.deepEqual(GUARDIAN_WRITE_CAPABILITIES, [], 'the shared list stays empty');
});

test('diary is not readable unless the senior shared it', () => {
  assert.deepEqual(visibleTables(guardian()), ['medications', 'doses', 'appointments', 'contacts']);
  assert.ok(!visibleTables(guardian()).includes('diary'), 'off by default');
  assert.ok(visibleTables(guardian({ share_diary: true })).includes('diary'));
});

// ---------------------------------------------------------------------- parsing

test('token shape is checked before any lookup', () => {
  assert.equal(looksLikeToken('x'.repeat(43)), true);
  assert.equal(looksLikeToken('short'), false);
  assert.equal(looksLikeToken(''), false);
  assert.equal(looksLikeToken(null), false);
  assert.equal(looksLikeToken(undefined), false);
  assert.equal(looksLikeToken(12345), false);
});

test('codes are six digits, whitespace and separators forgiven', () => {
  assert.equal(normaliseCode('482915'), '482915');
  assert.equal(normaliseCode('482 915'), '482915', 'read aloud with a gap');
  assert.equal(normaliseCode('482-915'), '482915');
  assert.equal(normaliseCode('48291'), null);
  assert.equal(normaliseCode('4829155'), null);
  assert.equal(normaliseCode('abcdef'), null);
  assert.equal(normaliseCode(null), null);
});
