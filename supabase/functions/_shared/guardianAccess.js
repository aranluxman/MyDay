// Guardian authorization decisions, as pure functions.
//
// Plain JS on purpose: Deno imports it directly from the `guardian-data` edge
// function, and node's test runner imports the same file, so the rules that
// decide whether a guardian device may read a senior's data are covered by
// tests rather than living only inside a deployed function.
//
// Nothing here touches the network or the database. Callers do the lookups and
// hand the rows in; these functions decide.

/** How long a 6-digit linking code stays valid. Short, because it is short. */
export const CODE_TTL_MINUTES = 15;

/** Tokens are 32 random bytes, base64url — never shorter than this. */
export const MIN_TOKEN_LENGTH = 20;

// A guardian never gets a write capability. This is asserted in tests so the
// list cannot be widened without someone noticing.
export const GUARDIAN_WRITE_CAPABILITIES = Object.freeze([]);

/** Tables a guardian may read, given their share settings. */
export function visibleTables(guardian) {
  const base = ['medications', 'doses', 'appointments', 'contacts'];
  return guardian?.share_diary ? [...base, 'diary'] : base;
}

// Identical wording for "no such token" and "revoked token": the guardian's
// next step is the same either way, and a prober learns nothing from the
// difference.
const UNLINKED = {
  ok: false,
  code: 'unlinked',
  status: 401,
  message: 'This device is no longer connected. Ask for a new 6-digit code.',
};

/**
 * May this device token read, and whose data?
 *
 * @param {{device: object|null, guardian: object|null, now?: number}} input
 * @returns {{ok: true, userId: string, reads: string[], writes: string[]}
 *          |{ok: false, code: string, status: number, message: string}}
 */
export function authorizeDevice({ device, guardian, now = Date.now() }) {
  if (!device) return UNLINKED;
  if (device.revoked_at && new Date(device.revoked_at).getTime() <= now) return UNLINKED;
  if (!guardian) return UNLINKED;
  if (guardian.status === 'revoked') return UNLINKED;
  // A device row must belong to the guardian row it was looked up through.
  if (device.guardian_id && guardian.id && device.guardian_id !== guardian.id) return UNLINKED;
  // Without a senior there is nothing to authorize against, and defaulting to
  // "allow" here would be the one mistake that matters.
  if (!guardian.user_id) return UNLINKED;

  return {
    ok: true,
    userId: guardian.user_id,
    reads: visibleTables(guardian),
    writes: [...GUARDIAN_WRITE_CAPABILITIES],
  };
}

/**
 * May this 6-digit code be used to link a new device?
 *
 * Single-use and short-lived: a 6-digit code has only 900k values, so its
 * value as a credential comes entirely from how briefly it is alive.
 */
export function authorizeCode({ guardian, now = Date.now() }) {
  if (!guardian || guardian.status === 'revoked') {
    return {
      ok: false, code: 'not_found', status: 404,
      message: 'That code was not recognised. Please check the digits and try again.',
    };
  }
  if (guardian.code_used_at) {
    return {
      ok: false, code: 'code_used', status: 410,
      message: 'That code has already been used. Ask them to show you a new one.',
    };
  }
  const exp = guardian.code_expires_at ? new Date(guardian.code_expires_at).getTime() : NaN;
  // A missing or unparseable expiry is treated as expired, never as forever.
  if (!Number.isFinite(exp) || exp < now) {
    return {
      ok: false, code: 'code_expired', status: 410,
      message: `That code has expired. Ask them to show you a new one — codes last ${CODE_TTL_MINUTES} minutes.`,
    };
  }
  if (!guardian.user_id) return { ...UNLINKED, code: 'not_found', status: 404 };

  return {
    ok: true,
    userId: guardian.user_id,
    reads: visibleTables(guardian),
    writes: [...GUARDIAN_WRITE_CAPABILITIES],
  };
}

/** A token is well-formed enough to be worth a database lookup. */
export function looksLikeToken(token) {
  return typeof token === 'string' && token.trim().length >= MIN_TOKEN_LENGTH;
}

/** Six digits, nothing else. */
export function normaliseCode(input) {
  const digits = String(input ?? '').replace(/\D/g, '');
  return digits.length === 6 ? digits : null;
}
