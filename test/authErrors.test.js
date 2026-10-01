// The reset screen must tell people the real reason a new password was
// refused — not send them for a fresh link that cannot help.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeResetError } from '../src/lib/authErrors.js';

test('a password below the project minimum asks for a longer one, not a new link', () => {
  const r = describeResetError({ code: 'weak_password', reasons: ['length'], message: 'Password should be at least 8 characters.', status: 422 });
  assert.equal(r.kind, 'form');
  assert.match(r.message, /at least 8 characters/);
  assert.doesNotMatch(r.message, /link/);
});

test('character rules are spelled out in plain words', () => {
  const r = describeResetError({
    code: 'weak_password', reasons: ['characters'], status: 422,
    message: 'Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789.',
  });
  assert.equal(r.kind, 'form');
  assert.match(r.message, /small letter/);
  assert.match(r.message, /capital letter/);
  assert.match(r.message, /a capital letter and a number\./);
});

test('a leaked password is called out as unsafe', () => {
  const r = describeResetError({ code: 'weak_password', reasons: ['pwned'], message: 'Password is known to be weak and easy to guess' });
  assert.match(r.message, /data leak/);
});

test('reusing the old password says so', () => {
  assert.match(describeResetError({ code: 'same_password', message: 'New password should be different from the old password.' }).message, /already had/);
});

test('a missing or expired session sends them for a new link', () => {
  assert.equal(describeResetError({ name: 'AuthSessionMissingError', message: 'Auth session missing!' }).kind, 'expired');
  assert.equal(describeResetError({ code: 'session_not_found', status: 403, message: 'Session not found' }).kind, 'expired');
  assert.equal(describeResetError({ code: 'bad_jwt', status: 401, message: 'invalid JWT' }).kind, 'expired');
});

test('an unknown failure keeps the server reason visible', () => {
  const r = describeResetError({ status: 500, message: 'Database error updating user' });
  assert.equal(r.kind, 'form');
  assert.match(r.message, /Database error updating user/);
});
