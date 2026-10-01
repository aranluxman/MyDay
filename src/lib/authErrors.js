// Turning a failed "save my new password" into words a person can act on.
//
// The reset screen used to answer every failure with "your link may have
// expired", which was wrong most of the time. The commonest real cause is the
// project's password rules: accounts are created through the admin API (see
// supabase/functions/signup), which skips those rules, but changing a password
// is checked against them. So a 6-letter password that was fine at sign-up can
// be refused here — and the person was told to fetch a new link, which can
// never help.
//
// Pure, no browser APIs, so it is unit-tested in test/authErrors.test.js.

/**
 * @returns {{ kind: 'expired' | 'form', message: string }}
 *   'expired' — the recovery session is gone; show "send me a new link".
 *   'form'    — keep them on the form, with this message above it.
 */
export function describeResetError(err) {
  const code = String(err?.code || '');
  const msg = String(err?.message || '');
  const reasons = Array.isArray(err?.reasons) ? err.reasons : [];

  if (code === 'same_password' || /same/i.test(msg) && /password/i.test(msg)) {
    return { kind: 'form', message: 'That is the password you already had. Please choose a different one.' };
  }

  if (code === 'weak_password' || reasons.length || /password should|weak password|password is known/i.test(msg)) {
    const parts = [];
    const len = /at least (\d+) characters/i.exec(msg)?.[1];
    if (reasons.includes('length') || len) parts.push(`at least ${len || 8} characters long`);
    if (reasons.includes('characters') || /one character of each/i.test(msg)) {
      parts.push(characterRule(msg));
    }
    if (reasons.includes('pwned') || /known to be weak|pwned|leak/i.test(msg)) {
      return { kind: 'form', message: 'That password has appeared in a data leak, so it is not safe. Please choose a different one.' };
    }
    return {
      kind: 'form',
      message: parts.length
        ? `That password is too simple. Please make it ${parts.join(', and ')}.`
        : 'That password is too simple. Please make it longer, with a mix of letters and numbers.',
    };
  }

  if (code === 'reauthentication_needed' || /reauthenticat/i.test(msg)) {
    return { kind: 'expired', message: 'For your safety we need to check it is you again. Please ask for a new link.' };
  }

  if (code === 'session_not_found' || code === 'bad_jwt' || code === 'refresh_token_not_found'
    || err?.name === 'AuthSessionMissingError' || /session missing|session.*(expired|not found)|jwt expired|invalid jwt/i.test(msg)
    || err?.status === 401 || err?.status === 403) {
    return { kind: 'expired', message: '' };
  }

  if (/fetch|network|failed to/i.test(msg)) {
    return { kind: 'form', message: 'We could not reach MyDay. Please check your internet and try again.' };
  }

  // Unknown: still say what the server said, so it can be reported and fixed.
  return { kind: 'form', message: `We could not change the password${msg ? ` (${msg})` : ''}. Please try again.` };
}

// Supabase lists the required groups in the message; turn them into words.
function characterRule(msg) {
  const need = [];
  if (/abcdefghijklmnopqrstuvwxyz/.test(msg)) need.push('a small letter');
  if (/ABCDEFGHIJKLMNOPQRSTUVWXYZ/.test(msg)) need.push('a capital letter');
  if (/0123456789/.test(msg)) need.push('a number');
  if (/[!@#$%^&*]/.test(msg.split(':').slice(1).join(':'))) need.push('a symbol like ! or #');
  return need.length ? `include ${listWords(need)}` : 'include a mix of letters, numbers and symbols';
}

function listWords(items) {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
