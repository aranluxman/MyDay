import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import {
  bandedPosition, landingIndex, nearestIndex, springStep, atRest, velocityFrom,
} from '../lib/liquid.js';

// The Liquid Glass "lens": one glass droplet that sits on the selected item
// of a bar (the tab bar, a segmented control) and can be grabbed and slid.
//
//   * Tap an item: it works exactly as before (a link, a button).
//   * Press and slide: past a small threshold the lens follows the finger
//     1:1, stretching in the direction it moves; at the ends it rubber-bands.
//   * Let go: momentum is projected forward and the lens springs to the
//     nearest item, which is then chosen (onCommit).
//
// Springs always start from the value on screen, so a lens that is still
// moving can be grabbed again mid-flight. With reduced motion (the OS
// setting or MyDay's Calm screen) it jumps instead of springing.

const DRAG_THRESHOLD = 8;
const SPRING = { damping: 1, response: 0.38 };
const FLICK_SPRING = { damping: 0.8, response: 0.38 };

export function motionAllowed() {
  if (typeof window === 'undefined') return false;
  if (document.documentElement.dataset.motion === 'calm') return false;
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// Real refraction (an SVG displacement map behind the glass) only renders in
// Chromium; elsewhere the same declaration would blank the blur. So it is
// switched on with a class, only where it works.
let refractReady = false;
function ensureRefraction() {
  if (refractReady || typeof document === 'undefined') return;
  refractReady = true;
  const brands = navigator.userAgentData?.brands?.map((b) => b.brand).join(' ') || '';
  if (!/Chromium|Google Chrome|Microsoft Edge/.test(brands)) return;
  // A displacement map: red runs left→right and green top→bottom, so pixels
  // near the edges are pulled inward — the bulge of a glass droplet.
  const map = `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">'
    + '<linearGradient id="r" x2="1"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#f00"/></linearGradient>'
    + '<linearGradient id="g" y2="1"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#0f0"/></linearGradient>'
    + '<rect width="100" height="100" fill="url(#r)"/>'
    + '<rect width="100" height="100" fill="url(#g)" style="mix-blend-mode:screen"/>'
    + '<filter id="b"><feGaussianBlur stdDeviation="7"/></filter>'
    + '<rect x="12" y="12" width="76" height="76" rx="38" fill="#808000" filter="url(#b)"/>'
    + '</svg>')}`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  svg.innerHTML = `<filter id="lg-refract" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feImage href="${map}" preserveAspectRatio="none" result="map"/>
    <feDisplacementMap in="SourceGraphic" in2="map" scale="6" xChannelSelector="R" yChannelSelector="G"/>
  </filter>`;
  document.body.appendChild(svg);
  document.documentElement.classList.add('lg-refract');
}

/**
 * @param {object} o
 * @param {React.RefObject<HTMLElement>} o.containerRef  the bar
 * @param {React.RefObject<HTMLElement>} o.lensRef       the glass droplet
 * @param {string}  o.itemSelector   items the lens can sit on
 * @param {'x'|'y'} [o.axis]         slide direction (the side rail is 'y')
 * @param {any}     o.activeKey      changes whenever the selected item does
 * @param {(index:number, el:HTMLElement)=>void} o.onCommit  choose an item
 * @param {boolean} [o.disabled]     e.g. a segmented control that wrapped
 */
export function useLiquidSlider({ containerRef, lensRef, itemSelector, axis = 'x', activeKey, onCommit, disabled = false }) {
  const s = useRef(null);
  if (!s.current) {
    s.current = {
      x: { x: 0, v: 0 }, y: { x: 0, v: 0 }, w: { x: 0, v: 0 }, h: { x: 0, v: 0 },
      lift: { x: 1, v: 0 }, stretch: { x: 0, v: 0 },
      target: { x: 0, y: 0, w: 0, h: 0, lift: 1, stretch: 0 },
      spring: SPRING, raf: 0, last: 0, placed: false, hidden: true,
      drag: null, suppressClick: false,
    };
  }
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  const items = useCallback(() => {
    const c = containerRef.current;
    if (!c) return [];
    return [...c.querySelectorAll(itemSelector)].filter((el) => el.offsetParent !== null);
  }, [containerRef, itemSelector]);

  const render = useCallback(() => {
    const lens = lensRef.current;
    const st = s.current;
    if (!lens) return;
    const lift = st.lift.x;
    const stretch = Math.max(-0.25, Math.min(0.25, st.stretch.x));
    const along = lift * (1 + Math.abs(stretch));
    const across = lift * (1 - Math.abs(stretch) * 0.45);
    const [sx, sy] = axis === 'x' ? [along, across] : [across, along];
    lens.style.width = `${Math.max(0, st.w.x)}px`;
    lens.style.height = `${Math.max(0, st.h.x)}px`;
    lens.style.transform = `translate3d(${st.x.x}px, ${st.y.x}px, 0) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
    lens.style.opacity = st.hidden ? '0' : '1';
  }, [lensRef, axis]);

  const tick = useCallback((now) => {
    const st = s.current;
    const dt = Math.min(0.032, Math.max(0.001, (now - (st.last || now)) / 1000 || 0.016));
    st.last = now;
    // The stretch relaxes as soon as the finger stops moving.
    if (st.drag && now - st.drag.lastMove > 60) st.target.stretch = 0;
    let moving = false;
    for (const k of ['x', 'y', 'w', 'h', 'lift', 'stretch']) {
      // While dragging, the main axis is glued to the finger (no spring).
      if (st.drag && st.drag.active && k === axis) continue;
      const spring = k === 'lift' || k === 'stretch' ? SPRING : st.spring;
      st[k] = springStep(st[k], st.target[k], dt, spring);
      if (!atRest(st[k], st.target[k])) moving = true;
      else st[k] = { x: st.target[k], v: 0 };
    }
    render();
    st.raf = moving || st.drag ? requestAnimationFrame(tick) : 0;
  }, [render, axis]);

  const kick = useCallback(() => {
    const st = s.current;
    if (!motionAllowed()) {
      cancelAnimationFrame(st.raf); st.raf = 0;
      for (const k of ['x', 'y', 'w', 'h', 'lift', 'stretch']) {
        if (st.drag && st.drag.active && k === axis) continue;
        st[k] = { x: k === 'lift' ? 1 : k === 'stretch' ? 0 : st.target[k], v: 0 };
      }
      render();
      return;
    }
    if (!st.raf) { st.last = 0; st.raf = requestAnimationFrame(tick); }
  }, [tick, render, axis]);

  // Sit on the active item: spring there after a change, jump on first paint
  // and on resize (a layout change shouldn't look like motion).
  const place = useCallback((jump) => {
    const st = s.current;
    if (st.drag?.active) return;
    const active = items().find((el) => el.classList.contains('is-active'));
    if (!active || disabled) { st.hidden = true; render(); return; }
    st.hidden = false;
    Object.assign(st.target, { x: active.offsetLeft, y: active.offsetTop, w: active.offsetWidth, h: active.offsetHeight, lift: 1, stretch: 0 });
    if (jump || !st.placed) {
      for (const k of ['x', 'y', 'w', 'h']) st[k] = { x: st.target[k], v: 0 };
      st.placed = true;
      render();
    } else {
      kick();
    }
  }, [items, render, kick, disabled]);

  useLayoutEffect(() => { place(false); }, [activeKey, disabled, place]);

  useEffect(() => {
    const c = containerRef.current;
    if (!c) return undefined;
    ensureRefraction();
    const onResize = () => place(true);
    window.addEventListener('resize', onResize);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    ro?.observe(c);
    return () => { window.removeEventListener('resize', onResize); ro?.disconnect(); cancelAnimationFrame(s.current.raf); };
  }, [containerRef, place]);

  // Pointer handling.
  useEffect(() => {
    const c = containerRef.current;
    if (!c || disabled) return undefined;
    const st = s.current;
    const pos = (e) => (axis === 'x' ? e.clientX : e.clientY);
    const offset = () => { const r = c.getBoundingClientRect(); return axis === 'x' ? r.left - c.scrollLeft + c.clientLeft : r.top - c.scrollTop + c.clientTop; };
    const size = (el) => (axis === 'x' ? el.offsetWidth : el.offsetHeight);
    const start = (el) => (axis === 'x' ? el.offsetLeft : el.offsetTop);

    function onDown(e) {
      if (e.button !== 0 || st.hidden) return;
      const list = items();
      const under = list.find((el) => el.contains(e.target));
      if (!under) return;
      const p = pos(e) - offset();
      // Where they grabbed, relative to the lens's own start, so it doesn't
      // snap its centre to the finger.
      const lensStart = st[axis].x;
      st.drag = {
        id: e.pointerId, startP: p, grab: p - lensStart, active: false, lastMove: performance.now(),
        samples: [{ t: performance.now(), p }], onActive: under.classList.contains('is-active'),
      };
      // Response on press, not release: the glass lifts under the finger.
      if (st.drag.onActive) { st.target.lift = 1.08; c.classList.add('is-pressed'); kick(); }
    }

    function onMove(e) {
      const d = st.drag;
      if (!d || e.pointerId !== d.id) return;
      const p = pos(e) - offset();
      const now = performance.now();
      d.samples.push({ t: now, p });
      if (d.samples.length > 8) d.samples.shift();
      if (!d.active) {
        if (Math.abs(p - d.startP) < DRAG_THRESHOLD) return;
        d.active = true;
        // Grabbed somewhere other than the lens: centre it under the finger.
        const lensSize = axis === 'x' ? st.w.x : st.h.x;
        if (!d.onActive) d.grab = lensSize / 2;
        try { c.setPointerCapture(e.pointerId); } catch {}
        c.classList.add('is-dragging');
        st.target.lift = 1.14;
        st.spring = SPRING;
      }
      d.lastMove = now;
      const list = items();
      if (!list.length) return;
      const lensSize = axis === 'x' ? st.w.x : st.h.x;
      const min = start(list[0]) + size(list[0]) / 2 - lensSize / 2;
      const max = start(list.at(-1)) + size(list.at(-1)) / 2 - lensSize / 2;
      const raw = p - d.grab;
      st[axis] = { x: bandedPosition(raw, min, max, size(list[0])), v: 0 };
      // Size and the cross axis follow whichever item the lens is over.
      const centers = list.map((el) => start(el) + size(el) / 2);
      const i = nearestIndex(centers, st[axis].x + lensSize / 2);
      const over = list[i];
      list.forEach((el, j) => el.classList.toggle('is-under', j === i));
      if (axis === 'x') Object.assign(st.target, { w: over.offsetWidth, y: over.offsetTop, h: over.offsetHeight });
      else Object.assign(st.target, { h: over.offsetHeight, x: over.offsetLeft, w: over.offsetWidth });
      const v = velocityFrom(d.samples, now);
      st.target.stretch = motionAllowed() ? Math.sign(v) * Math.min(0.2, Math.abs(v) / 3000) : 0;
      if (!motionAllowed()) render();
      kick();
    }

    function onUp(e) {
      const d = st.drag;
      if (!d || e.pointerId !== d.id) return;
      st.drag = null;
      c.classList.remove('is-pressed', 'is-dragging');
      st.target.lift = 1;
      st.target.stretch = 0;
      const list = items();
      list.forEach((el) => el.classList.remove('is-under'));
      if (!d.active) { kick(); return; }
      try { c.releasePointerCapture(e.pointerId); } catch {}
      const lensSize = axis === 'x' ? st.w.x : st.h.x;
      const centers = list.map((el) => start(el) + size(el) / 2);
      const v = e.type === 'pointercancel' ? 0 : velocityFrom(d.samples, performance.now());
      const i = landingIndex(centers, st[axis].x + lensSize / 2, v);
      const el = list[i];
      if (!el) { place(false); return; }
      // Hand the finger's velocity to the spring so there's no seam.
      st[axis] = { x: st[axis].x, v };
      st.spring = Math.abs(v) > 600 ? FLICK_SPRING : SPRING;
      Object.assign(st.target, { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
      kick();
      if (!el.classList.contains('is-active')) commitRef.current?.(i, el);
      // The browser's own click that follows a drag must not also land on
      // an item (set after committing, which may itself click one).
      st.suppressClick = true;
      setTimeout(() => { st.suppressClick = false; }, 400);
    }

    function onClick(e) {
      if (!st.suppressClick) return;
      st.suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    }

    // Tabs are links, and a pressed link starts the browser's own
    // drag-and-drop, which cancels the pointer. The bar is for sliding.
    const noNativeDrag = (e) => e.preventDefault();

    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerup', onUp);
    c.addEventListener('pointercancel', onUp);
    c.addEventListener('click', onClick, true);
    c.addEventListener('dragstart', noNativeDrag);
    return () => {
      c.removeEventListener('dragstart', noNativeDrag);
      c.removeEventListener('pointerdown', onDown);
      c.removeEventListener('pointermove', onMove);
      c.removeEventListener('pointerup', onUp);
      c.removeEventListener('pointercancel', onUp);
      c.removeEventListener('click', onClick, true);
    };
  }, [containerRef, items, axis, disabled, kick, place, render]);
}

/**
 * A switch knob you can press (it turns to glass and widens, like iOS 26)
 * and slide. Tap and keyboard still flip it the normal way; a drag that
 * ends past halfway — or is flicked that way — flips it on release.
 */
export function useLiquidSwitch({ ref, checked, onChange, disabled, travel = 22 }) {
  const st = useRef({ drag: null, suppressClick: false });
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const checkedRef = useRef(checked);
  checkedRef.current = checked;

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return undefined;
    const s = st.current;
    function onDown(e) {
      if (e.button !== 0) return;
      s.drag = { id: e.pointerId, x0: e.clientX, active: false, samples: [{ t: performance.now(), p: e.clientX }] };
      el.classList.add('is-pressed');
    }
    function onMove(e) {
      const d = s.drag;
      if (!d || e.pointerId !== d.id) return;
      const now = performance.now();
      d.samples.push({ t: now, p: e.clientX });
      if (d.samples.length > 8) d.samples.shift();
      const dx = e.clientX - d.x0;
      if (!d.active) {
        if (Math.abs(dx) < 4) return;
        d.active = true;
        try { el.setPointerCapture(e.pointerId); } catch {}
        el.classList.add('is-dragging');
      }
      const base = checkedRef.current ? travel : 0;
      const raw = base + dx;
      const x = raw < 0 ? -Math.sqrt(-raw) : raw > travel ? travel + Math.sqrt(raw - travel) : raw;
      el.style.setProperty('--knob-x', `${x}px`);
      el.classList.toggle('is-past', x > travel / 2);
    }
    function onUp(e) {
      const d = s.drag;
      if (!d || e.pointerId !== d.id) return;
      s.drag = null;
      el.classList.remove('is-pressed', 'is-dragging', 'is-past');
      if (!d.active) return;
      const v = e.type === 'pointercancel' ? 0 : velocityFrom(d.samples, performance.now());
      const base = checkedRef.current ? travel : 0;
      const projected = base + (e.clientX - d.x0) + (v / 1000) * 120;
      const next = projected > travel / 2;
      el.style.removeProperty('--knob-x');
      s.suppressClick = true;
      setTimeout(() => { s.suppressClick = false; }, 400);
      if (next !== checkedRef.current) changeRef.current(next);
    }
    function onClick(e) {
      if (!s.suppressClick) return;
      s.suppressClick = false;
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('click', onClick, true);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('click', onClick, true);
    };
  }, [ref, disabled, travel]);
}
