/**
 * EFFECT REGISTRY — per-scene looks for the reel.
 *
 * An effect has two optional halves, either of which may be omitted:
 *
 *   { label, filter, overlay(ctx, { W, H, t, p }) }
 *
 *   filter  — a CSS filter string applied to the CAPTURE as it's drawn (colour grading)
 *   overlay — drawn over the finished frame (vignette, grain, particles, light)
 *
 * `t` is elapsed seconds within the scene and `p` its 0→1 progress, so overlays can animate. Everything
 * random here is derived from a hashed index, never `Math.random()` — a re-render must be identical to
 * the last one or you can't diff two versions of a video.
 *
 * ── Where these belong ──────────────────────────────────────────────────────────────────────────
 * Effects are a REEL/social-ad feature and are deliberately not applied to store screenshots. Google
 * requires Play screenshots to show the app interface unaltered, and a graded or grain-covered UI
 * misrepresents what the user will see. Grade your ads, not your store listing.
 *
 * Ported from uspamin's collage effects (CSS filters + React overlay panes) onto Skia canvas ops.
 */
import { hexA } from './canvas.mjs';
import { softPeak } from './easings.mjs';

/** Deterministic pseudo-random in [0,1). */
const rnd = (n) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

/** Radial gradient helper. */
function radial(ctx, cx, cy, r, stops) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const [at, colour] of stops) g.addColorStop(at, colour);
  return g;
}

/** Draw an overlay pass with a blend mode + alpha, then restore. */
function blended(ctx, mode, alpha, draw) {
  ctx.save();
  ctx.globalCompositeOperation = mode;
  ctx.globalAlpha = alpha;
  draw(ctx);
  ctx.restore();
}

/** A field of drifting particles — the shared engine behind snow / sparkles / hearts / confetti. */
function particles(ctx, { W, H, t }, { count, seed = 0, speed, size, drift = 0.4, draw }) {
  for (let i = 0; i < count; i++) {
    const s = i + seed;
    const x0 = rnd(s) * W;
    const phase = rnd(s + 101);
    // Floor-mod, NOT `%`: JS remainder keeps the dividend's sign, so an upward field (negative speed)
    // wraps into [-1.2, 0) and the particle leaves the frame forever instead of re-entering from below.
    const cycle = ((((rnd(s + 7) + (t * speed) / H + phase) % 1.2) + 1.2) % 1.2);
    const y = cycle * H - H * 0.1;
    const x = x0 + Math.sin(t * 0.6 + phase * Math.PI * 2) * W * drift * 0.06;
    draw(ctx, x, y, size * (0.6 + rnd(s + 31) * 0.8), s);
  }
}

export const EFFECTS = {
  none: { label: 'No effect' },

  // ── Colour grades (filter only — no per-frame cost) ────────────────────────────────────────────
  bw: { label: 'Black & white', filter: 'grayscale(1) contrast(1.05)' },
  sepia: { label: 'Sepia', filter: 'sepia(0.75) contrast(1.02)' },
  cool: { label: 'Cool cast', filter: 'saturate(1.05) hue-rotate(-8deg) brightness(1.02)' },
  vibrant: { label: 'Vibrant', filter: 'saturate(1.35) contrast(1.06)' },
  'soft-faded': {
    label: 'Soft faded film',
    filter: 'contrast(0.92) brightness(1.06) saturate(0.9)',
    overlay: (ctx, { W, H }) => blended(ctx, 'source-over', 0.06, (c) => {
      c.fillStyle = '#fff8f0';
      c.fillRect(0, 0, W, H);
    }),
  },
  'warm-film': {
    label: 'Warm film',
    filter: 'sepia(0.22) saturate(1.12) contrast(1.03)',
    overlay: (ctx, { W, H }) => blended(ctx, 'soft-light', 0.35, (c) => {
      c.fillStyle = '#ffb367';
      c.fillRect(0, 0, W, H);
    }),
  },
  duotone: {
    label: 'Duotone',
    filter: 'grayscale(1) contrast(1.1)',
    overlay(ctx, { W, H }) {
      blended(ctx, 'multiply', 0.55, (c) => { c.fillStyle = '#2b1e5c'; c.fillRect(0, 0, W, H); });
      blended(ctx, 'screen', 0.35, (c) => { c.fillStyle = '#22c55e'; c.fillRect(0, 0, W, H); });
    },
  },

  // ── Optical ────────────────────────────────────────────────────────────────────────────────────
  vignette: {
    label: 'Vignette — darkens the corners',
    overlay: (ctx, { W, H }) => blended(ctx, 'source-over', 1, (c) => {
      c.fillStyle = radial(c, W / 2, H / 2, Math.hypot(W, H) * 0.62, [
        [0.55, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.45)'],
      ]);
      c.fillRect(0, 0, W, H);
    }),
  },

  'soft-glow': {
    label: 'Soft glow — light blooms out of the highlights',
    overlay: (ctx, { W, H }) => blended(ctx, 'screen', 0.18, (c) => {
      c.fillStyle = radial(c, W / 2, H * 0.42, Math.hypot(W, H) * 0.5, [
        [0, 'rgba(255,255,255,0.9)'], [1, 'rgba(255,255,255,0)'],
      ]);
      c.fillRect(0, 0, W, H);
    }),
  },

  'dreamy-haze': {
    label: 'Dreamy haze',
    filter: 'brightness(1.04) saturate(1.05)',
    overlay(ctx, { W, H }) {
      blended(ctx, 'screen', 0.22, (c) => {
        c.fillStyle = radial(c, W / 2, H * 0.5, Math.hypot(W, H) * 0.55, [
          [0, 'rgba(255,240,255,0.8)'], [1, 'rgba(255,240,255,0)'],
        ]);
        c.fillRect(0, 0, W, H);
      });
    },
  },

  bokeh: {
    label: 'Bokeh — drifting out-of-focus lights',
    overlay: (ctx, o) => blended(ctx, 'screen', 0.5, (c) => {
      c.filter = 'blur(6px)';
      particles(c, o, {
        count: 18, seed: 11, speed: -6, size: o.W * 0.05, drift: 1,
        draw: (cc, x, y, r, s) => {
          cc.fillStyle = hexA(s % 3 === 0 ? '#bbf7d0' : '#ffffff', 0.5 + rnd(s) * 0.4);
          cc.beginPath();
          cc.arc(x, y, r, 0, Math.PI * 2);
          cc.fill();
        },
      });
    }),
  },

  glare: {
    label: 'Glare — a static lens streak',
    overlay: (ctx, { W, H }) => blended(ctx, 'screen', 0.35, (c) => {
      const g = c.createLinearGradient(W * 0.1, 0, W * 0.5, H);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
    }),
  },

  floodlight: {
    label: 'Floodlight — a warm pool of stage light',
    overlay: (ctx, { W, H }) => blended(ctx, 'screen', 0.4, (c) => {
      c.fillStyle = radial(c, W / 2, H * 0.35, Math.hypot(W, H) * 0.55, [
        [0, 'rgba(255,214,160,0.8)'], [1, 'rgba(255,214,160,0)'],
      ]);
      c.fillRect(0, 0, W, H);
    }),
  },

  'light-leak': {
    label: 'Light leak — warm bleed from the edge',
    overlay: (ctx, { W, H, t }) => blended(ctx, 'screen', 0.4 + 0.15 * Math.sin(t * 0.8), (c) => {
      const g = c.createLinearGradient(W, 0, W * 0.45, H * 0.5);
      g.addColorStop(0, 'rgba(255,170,90,0.75)');
      g.addColorStop(1, 'rgba(255,170,90,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
    }),
  },

  // ── Film texture ───────────────────────────────────────────────────────────────────────────────
  'film-grain': {
    label: 'Film grain',
    overlay(ctx, { W, H, t }) {
      // Coarse procedural grain: a sparse field of 2px specks, re-seeded per frame so it shimmers the
      // way real grain does. Cheaper than a turbulence texture and deterministic per frame index.
      const frame = Math.round(t * 60); // finer than any output fps, so no frame reuses a pattern
      blended(ctx, 'overlay', 0.5, (c) => {
        for (let i = 0; i < 1400; i++) {
          const s = i + frame * 1400;
          c.fillStyle = rnd(s + 5) > 0.5 ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)';
          c.fillRect(rnd(s) * W, rnd(s + 2) * H, 2, 2);
        }
      });
    },
  },

  scanlines: {
    label: 'Scanlines — CRT texture',
    overlay: (ctx, { W, H }) => blended(ctx, 'overlay', 0.22, (c) => {
      c.fillStyle = '#000000';
      for (let y = 0; y < H; y += 4) c.fillRect(0, y, W, 2);
    }),
  },

  'dust-scratches': {
    label: 'Dust & scratches — projected-print wear',
    overlay(ctx, { W, H, t }) {
      const frame = Math.round(t * 12);
      blended(ctx, 'screen', 0.4, (c) => {
        for (let i = 0; i < 3; i++) {
          const s = i + frame * 13;
          if (rnd(s) > 0.55) continue;
          const x = rnd(s + 1) * W;
          c.strokeStyle = 'rgba(255,255,255,0.35)';
          c.lineWidth = 1 + rnd(s + 2);
          c.beginPath();
          c.moveTo(x, rnd(s + 3) * H * 0.4);
          c.lineTo(x + (rnd(s + 4) - 0.5) * 12, H * (0.5 + rnd(s + 5) * 0.5));
          c.stroke();
        }
        for (let i = 0; i < 14; i++) {
          const s = i + frame * 29;
          c.fillStyle = 'rgba(255,255,255,0.5)';
          c.fillRect(rnd(s) * W, rnd(s + 1) * H, 2, 2);
        }
      });
    },
  },

  // ── Particles ──────────────────────────────────────────────────────────────────────────────────
  'falling-snow': {
    label: 'Falling snow',
    overlay: (ctx, o) => blended(ctx, 'source-over', 0.85, (c) => particles(c, o, {
      count: 60, seed: 3, speed: 55, size: o.W * 0.006, drift: 1,
      draw: (cc, x, y, r) => { cc.fillStyle = 'rgba(255,255,255,0.9)'; cc.beginPath(); cc.arc(x, y, r, 0, Math.PI * 2); cc.fill(); },
    })),
  },

  'sparkles-fireflies': {
    label: 'Sparkles / fireflies',
    overlay: (ctx, o) => blended(ctx, 'screen', 0.9, (c) => particles(c, o, {
      count: 34, seed: 21, speed: -18, size: o.W * 0.008, drift: 1.6,
      draw: (cc, x, y, r, s) => {
        const tw = 0.35 + 0.65 * softPeak(((o.t * 0.7 + rnd(s)) % 1));
        cc.fillStyle = hexA('#fff7c2', tw);
        cc.beginPath();
        cc.arc(x, y, r, 0, Math.PI * 2);
        cc.fill();
      },
    })),
  },

  'heart-drift': {
    label: 'Drifting hearts',
    overlay: (ctx, o) => blended(ctx, 'source-over', 0.8, (c) => particles(c, o, {
      count: 16, seed: 41, speed: -26, size: o.W * 0.016, drift: 1.4,
      draw: (cc, x, y, r) => {
        cc.fillStyle = 'rgba(244,114,182,0.85)';
        cc.beginPath();
        for (let i = 0; i <= 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          const hx = 16 * Math.pow(Math.sin(a), 3);
          const hy = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
          const px = x + (hx * r) / 16;
          const py = y + (hy * r) / 16;
          if (i === 0) cc.moveTo(px, py); else cc.lineTo(px, py);
        }
        cc.closePath();
        cc.fill();
      },
    })),
  },

  'confetti-drift': {
    label: 'Drifting confetti',
    overlay: (ctx, o) => blended(ctx, 'source-over', 0.9, (c) => particles(c, o, {
      count: 40, seed: 61, speed: 42, size: o.W * 0.012, drift: 1.8,
      draw: (cc, x, y, r, s) => {
        const colours = ['#22c55e', '#f59e0b', '#38bdf8', '#f472b6', '#facc15'];
        cc.save();
        cc.translate(x, y);
        cc.rotate(rnd(s + 9) * Math.PI * 2 + o.t * 2);
        cc.fillStyle = colours[s % colours.length];
        cc.fillRect(-r / 2, -r / 4, r, r / 2);
        cc.restore();
      },
    })),
  },

  'clouds-drift': {
    label: 'Drifting clouds',
    overlay: (ctx, o) => blended(ctx, 'screen', 0.28, (c) => {
      c.filter = 'blur(18px)';
      particles(c, o, {
        count: 10, seed: 77, speed: -9, size: o.W * 0.16, drift: 2.2,
        draw: (cc, x, y, r) => { cc.fillStyle = 'rgba(255,255,255,0.6)'; cc.beginPath(); cc.arc(x, y, r, 0, Math.PI * 2); cc.fill(); },
      });
    }),
  },
};

/** Resolve an effect id, with a helpful error listing what's available. */
export function effectFor(id) {
  const e = EFFECTS[id || 'none'];
  if (!e) throw new Error(`Unknown effect "${id}". Available: ${Object.keys(EFFECTS).join(', ')}.`);
  return e;
}

export const EFFECT_IDS = Object.keys(EFFECTS);
