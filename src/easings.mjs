/**
 * Easing + numeric helpers.
 *
 * Ported from a production video pipeline (uspamin's collage player), where each of these earned its
 * place by fixing a specific visible artefact rather than by being mathematically tidy:
 *
 *   • `smoothstep` on opacity kills the luminance valley in the middle of a cross-dissolve — a linear
 *     blend of two images dips visibly darker at 50%.
 *   • `qPct` quantises percentage transforms; sub-0.01% jitter makes shadows and hairlines shimmer
 *     between frames even when the motion itself is correct.
 *   • `softPeak` replaces `sin(x)^4`-style pulses, which land their peak on a single frame and read as
 *     a judder rather than a swell.
 */

/** Decelerating — the default for anything entering. */
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/** Accelerating — for anything leaving. */
export const easeInCubic = (t) => t * t * t;

/** Symmetric ease; the workhorse for camera moves and slides. */
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Sharper deceleration than cubic — good for a snap that still lands softly. */
export const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);

/** Gentle both ends, no overshoot. */
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

/** Hermite S-curve. Use on OPACITY during a dissolve (see the note above). */
export const smoothstep = (t) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** Second-order smoothstep — zero first AND second derivative at both ends. */
export const smootherstep = (t) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
};

/** Overshoot-and-settle, for something that should feel physical on arrival. */
export const easeOutBack = (t, s = 1.2) => {
  const c3 = s + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
};

/** A swell that HOLDS near its peak instead of spiking on one frame. */
export const softPeak = (t) => {
  const x = Math.min(1, Math.max(0, t));
  const bell = Math.sin(Math.PI * x);
  return bell * bell * (3 - 2 * bell) * 0.5 + bell * 0.5;
};

/** Quantise a percentage to 0.01% — kills inter-frame shimmer on shadows and hairlines. */
export const qPct = (v) => Math.round(v * 10000) / 10000;

/**
 * Overdamped spring 0→1, integrated per frame (semi-implicit Euler) — the "one earned camera move".
 * Overdamped on purpose: it settles without a bounce, which on a product shot reads as confidence.
 */
export function springSeries(frames, fps, { stiffness = 26, damping = 26, mass = 1.4 } = {}) {
  const dt = 1 / fps;
  let x = 0;
  let v = 0;
  const out = new Array(frames);
  for (let f = 0; f < frames; f++) {
    const a = (stiffness * (1 - x) - damping * v) / mass;
    v += a * dt;
    x += v * dt;
    out[f] = x;
  }
  return out;
}
