import { useEffect, useRef } from 'react';
import { rubberband, velocityFrom, springStep, atRest, sheetShouldDismiss } from '../lib/liquid.js';

// Drag a bottom sheet down to close it, the way iOS sheets work. The sheet
// is picked up by its grabber or title bar (never the scrolling body, so
// reading and scrolling stay exactly as they were), follows the finger 1:1
// from wherever it was grabbed, resists being pulled up, and on release
// either springs home or closes, carrying the finger's speed into the
// motion so there is no seam. Grabbing it again mid-spring picks it up from
// where it is on screen. Escape, the X and a tap outside still close it.
//
// `onDismiss` runs once the sheet has slid away. With `keepOpen`, it slides
// home instead and onDismiss runs after (the medicine wizard uses this, so
// it can still ask before throwing away changes).
const HANDLE = '.sheet__grab, .sheet__head, .wiz__head, .sheet__grabzone';
const CLOSE = { damping: 1, response: 0.3 };
// A release carries momentum, so a little bounce on the way home is earned.
const HOME = { damping: 0.85, response: 0.32 };

const calm = () => document.documentElement.dataset.motion === 'calm'
  || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function useSheetDrag(sheetRef, { onDismiss, keepOpen = false, disabled = false } = {}) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet || disabled) return undefined;
    const overlay = sheet.parentElement;
    const st = { x: 0, v: 0, raf: 0, id: null, start: 0, grab: 0, samples: [], moved: false };

    function paint(y) {
      sheet.style.transform = y ? `translateY(${y}px)` : '';
      const h = sheet.offsetHeight || 1;
      // Only the dimming fades. Fading the overlay itself would fade the sheet
      // inside it too, and break the sheet's own frosted backdrop.
      if (overlay) {
        if (y > 0) overlay.style.setProperty('--scrim', String(Math.max(0, 1 - y / h)));
        else overlay.style.removeProperty('--scrim');
      }
    }
    function stop() { cancelAnimationFrame(st.raf); st.raf = 0; }
    function animateTo(target, cfg, done) {
      stop();
      if (calm()) { st.x = target; st.v = 0; paint(target); done?.(); return; }
      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min(0.032, (now - last) / 1000);
        last = now;
        const next = springStep(st, target, dt, cfg);
        st.x = next.x; st.v = next.v;
        // Closing never needs to settle exactly: once off screen, it is gone.
        if (atRest(st, target) || (target > 0 && st.x >= target - 1)) {
          st.x = target; st.v = 0; paint(target); st.raf = 0; done?.();
          return;
        }
        paint(st.x);
        st.raf = requestAnimationFrame(tick);
      };
      st.raf = requestAnimationFrame(tick);
    }

    function down(e) {
      if (e.button > 0 || st.id != null) return;
      if (!e.target.closest(HANDLE) || e.target.closest('button, a, input, select, textarea, [role="switch"]')) return;
      stop(); // grabbed mid-spring: carry on from where it is
      st.id = e.pointerId;
      st.grab = e.clientY - st.x;
      st.start = e.clientY;
      st.moved = false;
      st.samples = [{ t: e.timeStamp, p: e.clientY }];
      sheet.style.animation = 'none';
      sheet.style.transition = 'none';
    }
    function move(e) {
      if (e.pointerId !== st.id) return;
      // A little hysteresis so a tap on the title bar is still a tap.
      if (!st.moved) {
        if (Math.abs(e.clientY - st.start) < 8) return;
        st.moved = true;
        sheet.setPointerCapture?.(e.pointerId);
        sheet.classList.add('is-dragging');
      }
      e.preventDefault();
      const raw = e.clientY - st.grab;
      st.x = raw < 0 ? rubberband(raw, sheet.offsetHeight) : raw;
      st.samples.push({ t: e.timeStamp, p: e.clientY });
      if (st.samples.length > 8) st.samples.shift();
      paint(st.x);
    }
    function up(e) {
      if (e.pointerId !== st.id) return;
      st.id = null;
      sheet.classList.remove('is-dragging');
      if (!st.moved) return;
      st.v = e.type === 'pointercancel' ? 0 : velocityFrom(st.samples, e.timeStamp);
      const h = sheet.offsetHeight;
      if (sheetShouldDismiss(st.x, st.v, h)) {
        if (keepOpen) animateTo(0, HOME, () => dismissRef.current?.());
        else animateTo(h + 24, CLOSE, () => dismissRef.current?.());
      } else {
        animateTo(0, HOME);
      }
    }

    sheet.addEventListener('pointerdown', down);
    sheet.addEventListener('pointermove', move);
    sheet.addEventListener('pointerup', up);
    sheet.addEventListener('pointercancel', up);
    return () => {
      stop();
      sheet.removeEventListener('pointerdown', down);
      sheet.removeEventListener('pointermove', move);
      sheet.removeEventListener('pointerup', up);
      sheet.removeEventListener('pointercancel', up);
    };
  }, [sheetRef, keepOpen, disabled]);
}
