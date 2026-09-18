// Card masking and expiry. Masking is a privacy control, so the tests care
// most about what it must never reveal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  maskCardNumber, isExpired, expiryLabel, sortCards, reorder, cardTypeLabel, CARD_TYPES,
} from '../src/lib/cards.js';

test('masking reveals exactly four alphanumerics, keeping the shape', () => {
  assert.equal(maskCardNumber('1234567890'), '••••••7890');
  // Separators are preserved, so the masked number still looks like the card
  // it came from. Four ALPHANUMERICS are revealed (7,8,9,0) — the space in
  // between is not one of them, which is why the 7 shows.
  assert.equal(maskCardNumber('1234 567 890'), '•••• ••7 890');
  assert.equal(maskCardNumber('1234-5678-9012'), '••••-••••-9012');
  assert.equal(maskCardNumber('AB 12 CD 34'), '•• •• CD 34');
});

test('masking never reveals more than the window, whatever the separators', () => {
  // The guarantee that actually matters: count the revealed alphanumerics.
  const revealed = (masked) => masked.replace(/[^a-z0-9]/gi, '').length;
  for (const n of ['1234567890', '1234 567 890', '1234-5678-9012', 'AB 12 CD 34', '1 2 3 4 5 6']) {
    assert.equal(revealed(maskCardNumber(n)), 4, `${n} leaked more than four`);
  }
});

test('a number shorter than the reveal window is masked completely', () => {
  // Showing "123" of a 3-character number would reveal all of it.
  assert.equal(maskCardNumber('123'), '•••');
  assert.equal(maskCardNumber('12'), '••');
  assert.equal(maskCardNumber('1'), '•');
});

test('masking handles empty input without inventing bullets', () => {
  assert.equal(maskCardNumber(''), '');
  assert.equal(maskCardNumber('   '), '');
  assert.equal(maskCardNumber(null), '');
  assert.equal(maskCardNumber(undefined), '');
});

test('the visible window is configurable and still safe', () => {
  assert.equal(maskCardNumber('1234567890', 2), '••••••••90');
  assert.equal(maskCardNumber('1234567890', 0), '••••••••••', 'zero reveals nothing');
});

test('expiry is only claimed when the date actually parses', () => {
  const now = new Date('2026-09-18T12:00:00');
  assert.equal(isExpired('2025-01', now), true);
  assert.equal(isExpired('2027-01', now), false);
  assert.equal(isExpired('01/2025', now), true);
  assert.equal(isExpired('01/27', now), false);
  assert.equal(isExpired('2026-09-17', now), true, 'yesterday');
  assert.equal(isExpired('2026-09-19', now), false, 'tomorrow');
});

test('a month expiry lasts to the end of that month', () => {
  // A card marked 09/2026 is valid all through September.
  assert.equal(isExpired('2026-09', new Date('2026-09-18T12:00:00')), false);
  assert.equal(isExpired('2026-09', new Date('2026-09-30T23:00:00')), false);
  assert.equal(isExpired('2026-09', new Date('2026-10-01T00:30:00')), true);
});

test('an unparseable expiry never reports as expired', () => {
  // Telling someone their health card has expired when it has not would send
  // them to a service desk for nothing.
  for (const junk of ['soon', '', '13/2026', 'next year', null, undefined]) {
    assert.equal(isExpired(junk, new Date('2026-09-18')), false, `${JSON.stringify(junk)}`);
  }
});

test('expiryLabel says nothing when there is nothing to say', () => {
  assert.equal(expiryLabel(''), null);
  assert.equal(expiryLabel(null), null);
  assert.equal(expiryLabel('2027-06'), 'Expires 2027-06');
});

test('cards sort by the order the person arranged', () => {
  const cards = [
    { id: 'c', sort_order: 2, created_at: '2026-01-03' },
    { id: 'a', sort_order: 0, created_at: '2026-01-01' },
    { id: 'b', sort_order: 1, created_at: '2026-01-02' },
  ];
  assert.deepEqual(sortCards(cards).map((c) => c.id), ['a', 'b', 'c']);
  assert.deepEqual(sortCards([]), []);
  assert.deepEqual(sortCards(null), []);
});

test('reordering renumbers every card so the order is stable', () => {
  const cards = [
    { id: 'a', sort_order: 0 }, { id: 'b', sort_order: 1 }, { id: 'c', sort_order: 2 },
  ];
  assert.deepEqual(reorder(cards, 2, 0).map((c) => c.id), ['c', 'a', 'b']);
  assert.deepEqual(reorder(cards, 2, 0).map((c) => c.sort_order), [0, 1, 2]);
  assert.deepEqual(reorder(cards, 0, 2).map((c) => c.id), ['b', 'c', 'a']);
  // Out-of-range moves leave the list alone rather than corrupting it.
  assert.deepEqual(reorder(cards, 9, 0).map((c) => c.id), ['a', 'b', 'c']);
  assert.deepEqual(reorder(cards, 0, -1).map((c) => c.id), ['a', 'b', 'c']);
});

test('every card type has a label', () => {
  for (const t of CARD_TYPES) assert.ok(cardTypeLabel(t.id).length > 0);
  assert.equal(cardTypeLabel('nonsense'), 'Card');
});
