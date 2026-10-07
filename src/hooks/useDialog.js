import { useEffect, useRef } from 'react';

// Modal dialog behaviour, shared by every sheet, wizard, picker and alert.
//
// What a modal has to do, and what the audit found missing:
//   * focus moves into it when it opens,
//   * Tab and Shift+Tab stay inside the TOPMOST dialog (Tab from the wizard's
//     last control used to reach <body>, then "Download now" behind it),
//   * everything behind it is inert — not clickable, not focusable, not read
//     out — so a screen reader cannot wander into the page underneath,
//   * Escape closes only the topmost dialog (the time picker, not the whole
//     wizard underneath it),
//   * when it closes, focus goes back to whatever opened it.
//
// Dialogs nest (wizard -> time picker -> confirm), so they are tracked as a
// stack and only the top one is live.

const FOCUSABLE = [
  'a[href]', 'area[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', 'iframe', 'audio[controls]', 'video[controls]',
  '[contenteditable]:not([contenteditable="false"])', '[tabindex]:not([tabindex="-1"])',
].join(',');

const stack = [];
const inerted = new Set();

export function focusableIn(node) {
  return [...node.querySelectorAll(FOCUSABLE)].filter((el) => {
    if (el.closest('[inert]')) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const r = el.getBoundingClientRect();
    // Hidden (display:none / collapsed) controls cannot take focus.
    return r.width > 0 || r.height > 0 || el === document.activeElement;
  });
}

/** The child of <body> that contains `node` (a portal root). */
function bodyChildOf(node) {
  let el = node;
  while (el && el.parentElement && el.parentElement !== document.body) el = el.parentElement;
  return el;
}

function updateBackground() {
  for (const el of inerted) { el.inert = false; el.removeAttribute('aria-hidden'); }
  inerted.clear();
  const top = stack[stack.length - 1];
  document.body.classList.toggle('no-scroll', stack.length > 0);
  if (!top) return;
  const keep = bodyChildOf(top.node);
  for (const el of document.body.children) {
    if (el === keep || el.tagName === 'SCRIPT' || el.hasAttribute('data-dialog-exempt')) continue;
    if (el.inert) continue;
    el.inert = true;
    // inert already hides it from assistive tech; aria-hidden covers older
    // engines that do not support inert yet.
    el.setAttribute('aria-hidden', 'true');
    inerted.add(el);
  }
}

function onKeyDown(e) {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (e.key === 'Escape') {
    if (top.escape.current) {
      e.preventDefault();
      e.stopPropagation();
      top.escape.current();
    }
    return;
  }
  if (e.key !== 'Tab') return;
  const items = focusableIn(top.node);
  if (!items.length) { e.preventDefault(); top.node.focus(); return; }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  const inside = top.node.contains(active);
  if (e.shiftKey && (active === first || !inside || active === top.node)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (active === last || !inside)) { e.preventDefault(); first.focus(); }
}

// Focus that escapes by any other route (a click on something odd, a script)
// is pulled back into the top dialog.
function onFocusIn(e) {
  const top = stack[stack.length - 1];
  if (!top || top.node.contains(e.target)) return;
  if (e.target.closest?.('[data-dialog-exempt]')) return;
  (focusableIn(top.node)[0] || top.node).focus({ preventScroll: true });
}

let listening = false;
function listen(on) {
  if (on && !listening) {
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    listening = true;
  } else if (!on && listening) {
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('focusin', onFocusIn, true);
    listening = false;
  }
}

/**
 * @param ref       ref to the element with role="dialog" / "alertdialog"
 * @param options   { onEscape?: () => void, initialFocus?: ref }
 *                  Without onEscape, Escape does nothing (for dialogs whose
 *                  dismissal would lose something and must be explicit).
 */
export function useDialog(ref, { onEscape, initialFocus } = {}) {
  const escape = useRef(onEscape);
  escape.current = onEscape;

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const opener = document.activeElement;
    if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
    const entry = { node, escape };
    stack.push(entry);
    listen(true);
    updateBackground();

    const target = initialFocus?.current || node.querySelector('[data-autofocus]') || node;
    // After paint, so an entrance animation or a portal has the node attached.
    const raf = requestAnimationFrame(() => {
      if (!node.contains(document.activeElement)) target.focus({ preventScroll: true });
    });

    return () => {
      cancelAnimationFrame(raf);
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      updateBackground();
      if (!stack.length) listen(false);
      // Back to the opener if it still exists and is usable; otherwise to the
      // dialog now on top, so focus never falls to <body>.
      const next = stack[stack.length - 1];
      if (opener && opener.isConnected && opener !== document.body && !opener.closest('[inert]')) {
        opener.focus({ preventScroll: true });
      } else if (next) {
        (focusableIn(next.node)[0] || next.node).focus({ preventScroll: true });
      }
    };
  }, []);
}

/** Test hook: how many dialogs are currently open. */
export const openDialogCount = () => stack.length;
