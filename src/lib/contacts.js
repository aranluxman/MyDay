// Contact helpers, kept pure so they can be tested.

export const CONTACT_TYPES = [
  { value: 'pharmacy', label: 'Pharmacy', icon: 'cross' },
  { value: 'provider', label: 'Doctor or prescriber', icon: 'user' },
  { value: 'clinic', label: 'Clinic', icon: 'building' },
  { value: 'insurance', label: 'Insurance', icon: 'shield' },
  { value: 'merchant', label: 'Shop', icon: 'cart' },
  { value: 'other', label: 'Family or other', icon: 'star' },
];

/**
 * A phone number someone could actually dial: 7–15 digits (E.164 allows up
 * to 15), an optional leading +, and only spaces, dots, dashes and brackets
 * between them. Empty is allowed — the field is optional.
 */
export function validPhone(raw) {
  const t = String(raw ?? '').trim();
  if (!t) return true;
  if (!/^\+?[\d\s().-]+$/.test(t)) return false;
  const digits = t.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

/** A tel: link for a valid number, or null. */
export function telHref(raw) {
  const t = String(raw ?? '').trim();
  if (!t || !validPhone(t)) return null;
  return `tel:${t.startsWith('+') ? '+' : ''}${t.replace(/\D/g, '')}`;
}
