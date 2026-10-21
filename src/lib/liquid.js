// Liquid Glass physics, kept pure so it can be tested without a browser.
//
// The numbers are Apple's, from "Designing Fluid Interfaces" (WWDC 2018):
// springs described by damping ratio + response instead of a duration,
// momentum projected forward on release, and rubber-banding at the edges.

/** Where a flick would come to rest: Apple's exponential-decay projection. */
export function project(velocity, decelerationRate = 0.998) {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Progressive resistance past an edge — slows before it stops. */
export function rubberband(overshoot, dimension, constant = 0.55) {
  if (!dimension) return 0;
  const sign = overshoot < 0 ? -1 : 1;
  const o = Math.abs(overshoot);
  return sign * ((o * dimension * constant) / (dimension + constant * o));
}

/** Index of the centre closest to `pos`. */
export function nearestIndex(centers, pos) {
  let best = -1;
  let bestD = Infinity;
  centers.forEach((c, i) => {
    const d = Math.abs(c - pos);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

/** Clamp `pos` between the first and last centre, rubber-banding past them. */
export function bandedPosition(pos, min, max, dimension) {
  if (pos < min) return min + rubberband(pos - min, dimension);
  if (pos > max) return max + rubberband(pos - max, dimension);
  return pos;
}

/**
 * Velocity (px/s) from a short history of { t, p } samples. Only the last
 * ~100ms count, so a finger that stopped before lifting reads as stopped.
 */
export function velocityFrom(samples, now = samples.at(-1)?.t ?? 0) {
  const recent = samples.filter((s) => now - s.t <= 100);
  if (recent.length < 2) return 0;
  const a = recent[0];
  const b = recent.at(-1);
  const dt = b.t - a.t;
  return dt > 0 ? ((b.p - a.p) / dt) * 1000 : 0;
}

/**
 * Which item a released drag lands on: project the momentum forward, then
 * snap to the nearest centre to that projected point. Tabs sit close
 * together, so this uses Apple's "snappier" rate (0.99): a scroll-like 0.998
 * would throw a gentle slide right past the tab under the finger.
 */
export function landingIndex(centers, pos, velocity, decelerationRate = 0.99) {
  const lo = centers[0];
  const hi = centers.at(-1);
  const projected = Math.min(hi, Math.max(lo, pos + project(velocity, decelerationRate)));
  return nearestIndex(centers, projected);
}

/**
 * One critically-damped (or slightly bouncy) spring step. Semi-implicit
 * Euler, which stays stable at 60–120Hz. `response` is seconds; damping 1.0
 * means no overshoot.
 */
export function springStep(state, target, dt, { damping = 1, response = 0.35 } = {}) {
  const k = (2 * Math.PI / response) ** 2;
  const c = (4 * Math.PI * damping) / response;
  const accel = -k * (state.x - target) - c * state.v;
  const v = state.v + accel * dt;
  const x = state.x + v * dt;
  return { x, v };
}

export const atRest = (s, target) => Math.abs(s.x - target) < 0.05 && Math.abs(s.v) < 0.05;
