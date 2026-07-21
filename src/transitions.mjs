/**
 * TRANSITION REGISTRY — the per-scene cut vocabulary.
 *
 * A transition is a pure function of `p` (0→1 through the cut) that composites two already-painted
 * layers onto the output frame. Nothing here knows what a scene is, how it was drawn, or where the
 * pixels came from, so adding one is an entry in this table and nothing else.
 *
 *   { dur, label, paint(ctx, prev, next, p, { W, H }) }
 *
 * Config picks one per scene: `{ id: 'study', cut: 'flip' }` — `cut` names how we get INTO that scene.
 *
 * ── On restraint ────────────────────────────────────────────────────────────────────────────────
 * The DEFAULT is deliberately the plainest entry here. A montage that reaches for a different
 * decorative transition at every boundary is the loudest amateur tell — so hard cuts carry the rhythm,
 * dissolves are spent where the meaning changes, and the expressive ones are opt-in. The library is
 * broad because *social ads* legitimately want that range; the defaults stay disciplined because store
 * previews don't. `auto` splits the difference: a deterministic rotation that stays mostly plain.
 *
 * Ported from uspamin's collage player, whose 33 transitions were CSS (transform / opacity / clip-path /
 * mix-blend-mode). Here the same maths drives Skia canvas ops instead: `clip(Path2D)` for the wipes and
 * irises, `globalCompositeOperation` for the light effects, `ctx.filter` for blur, and an X-scale about
 * the centre as the honest 2D projection of a Y-axis rotation.
 */
import { smoothstep, smootherstep, easeInCubic, easeOutCubic, easeInOutCubic, easeOutBack, softPeak } from './easings.mjs';
import { hexA } from './canvas.mjs';
import { createCanvas } from '@napi-rs/canvas';

/** A transparent scratch canvas the size of the frame, for transitions that must mask before compositing. */
const scratchLike = (_ctx, W, H) => createCanvas(W, H);

/** Draw a layer under an arbitrary clip path. */
function clipped(ctx, layer, buildPath) {
  ctx.save();
  ctx.beginPath();
  buildPath(ctx);
  ctx.clip();
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

/** Draw a layer with a transform applied about a pivot. */
function transformed(ctx, layer, { x = 0, y = 0, scale = 1, scaleX = 1, scaleY = 1, rotate = 0, alpha = 1, pivotX, pivotY, W, H, filter }) {
  const px = pivotX ?? W / 2;
  const py = pivotY ?? H / 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (filter) ctx.filter = filter;
  ctx.translate(px + x, py + y);
  ctx.rotate(rotate);
  ctx.scale(scale * scaleX, scale * scaleY);
  ctx.translate(-px, -py);
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

/** Full-frame colour flash / dip, `a` = 0..1 opacity. */
function veil(ctx, colour, a, W, H) {
  if (a <= 0) return;
  ctx.fillStyle = hexA(colour, Math.min(1, a));
  ctx.fillRect(0, 0, W, H);
}

/** Deterministic pseudo-random in [0,1) — same frame renders identically on every machine. */
const rnd = (n) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

export const TRANSITIONS = {
  // ── Plain (the working vocabulary) ─────────────────────────────────────────────────────────────
  cut: {
    dur: 1 / 24,
    label: 'Hard cut — instant change of subject (default)',
    paint: (ctx, prev, next, p) => void ctx.drawImage(p < 0.5 ? prev : next, 0, 0),
  },

  dissolve: {
    dur: 0.45,
    label: 'Cross-dissolve — a change of meaning, or a bookend',
    paint(ctx, prev, next, p) {
      ctx.drawImage(prev, 0, 0);
      // smoothstep, not linear: a linear opacity blend dips visibly darker at the midpoint.
      ctx.globalAlpha = smoothstep(p);
      ctx.drawImage(next, 0, 0);
      ctx.globalAlpha = 1;
    },
  },

  'cinematic-dissolve': {
    dur: 0.7,
    label: 'Dissolve with a slow breath of scale',
    paint(ctx, prev, next, p, { W, H }) {
      transformed(ctx, prev, { scale: 1 + 0.02 * p, W, H });
      transformed(ctx, next, { scale: 1.02 - 0.02 * p, alpha: smoothstep(p), W, H });
    },
  },

  'match-cut': {
    dur: 0.28,
    label: 'Match cut — snaps early, then holds (subjects that rhyme)',
    paint(ctx, prev, next, p) {
      const ACTION_END = 0.18;
      ctx.drawImage(prev, 0, 0);
      ctx.globalAlpha = smoothstep(Math.min(1, p / ACTION_END));
      ctx.drawImage(next, 0, 0);
      ctx.globalAlpha = 1;
    },
  },

  // ── Chapter breaks ─────────────────────────────────────────────────────────────────────────────
  'fade-through-black': {
    dur: 0.7,
    label: 'Dip to black — a chapter break',
    paint(ctx, prev, next, p, { W, H }) {
      ctx.drawImage(p < 0.5 ? prev : next, 0, 0);
      veil(ctx, '#000000', 1 - Math.abs(p - 0.5) * 2, W, H);
    },
  },

  'dip-to-white': {
    dur: 0.6,
    label: 'Dip to white — a lighter chapter break',
    paint(ctx, prev, next, p, { W, H }) {
      ctx.drawImage(p < 0.5 ? prev : next, 0, 0);
      veil(ctx, '#ffffff', 1 - Math.abs(p - 0.5) * 2, W, H);
    },
  },

  'soft-flash': {
    dur: 0.35,
    label: 'Soft white bloom over the cut',
    paint(ctx, prev, next, p, { W, H }) {
      ctx.drawImage(prev, 0, 0);
      ctx.globalAlpha = smoothstep(p);
      ctx.drawImage(next, 0, 0);
      ctx.globalAlpha = 1;
      veil(ctx, '#ffffff', 0.55 * softPeak(p), W, H);
    },
  },

  // ── Camera-through ─────────────────────────────────────────────────────────────────────────────
  'slow-zoom-through': {
    dur: 0.6,
    label: 'Push in through the cut',
    paint(ctx, prev, next, p, { W, H }) {
      transformed(ctx, prev, { scale: 1 + 0.12 * easeInCubic(p), alpha: 1, W, H });
      transformed(ctx, next, { scale: 1.1 - 0.1 * easeOutCubic(p), alpha: smoothstep(p), W, H });
    },
  },

  'pull-out': {
    dur: 0.6,
    label: 'Pull back through the cut',
    paint(ctx, prev, next, p, { W, H }) {
      transformed(ctx, prev, { scale: 1 - 0.08 * easeInCubic(p), W, H });
      transformed(ctx, next, { scale: 0.92 + 0.08 * easeOutCubic(p), alpha: smoothstep(p), W, H });
    },
  },

  'soft-zoom-punch': {
    dur: 0.3,
    label: 'Fast scale punch — energy on the beat',
    paint(ctx, prev, next, p, { W, H }) {
      const e = easeOutCubic(p);
      transformed(ctx, prev, { scale: 1 + 0.06 * e, W, H });
      transformed(ctx, next, { scale: 1.08 - 0.08 * e, alpha: smoothstep(Math.min(1, p * 1.6)), W, H });
    },
  },

  'frame-fill': {
    dur: 0.5,
    label: 'The incoming frame scales up to fill',
    paint(ctx, prev, next, p, { W, H }) {
      ctx.drawImage(prev, 0, 0);
      transformed(ctx, next, { scale: 0.6 + 0.4 * easeOutBack(p), alpha: smoothstep(Math.min(1, p * 1.4)), W, H });
    },
  },

  // ── Movement ───────────────────────────────────────────────────────────────────────────────────
  push: {
    dur: 0.42,
    label: 'Push — navigation within the app',
    paint(ctx, prev, next, p, { W }) {
      const e = easeInOutCubic(p);
      ctx.drawImage(prev, -W * e, 0);
      ctx.drawImage(next, W * (1 - e), 0);
    },
  },

  'page-slide': {
    dur: 0.5,
    label: 'The incoming page slides over the outgoing one',
    paint(ctx, prev, next, p, { W }) {
      ctx.drawImage(prev, -W * 0.18 * easeInOutCubic(p), 0);
      ctx.drawImage(next, W * (1 - easeInOutCubic(p)), 0);
    },
  },

  'warp-slide': {
    dur: 0.45,
    label: 'Slide with a stretch — speed you can feel',
    paint(ctx, prev, next, p, { W, H }) {
      const e = easeInOutCubic(p);
      const stretch = 1 + 0.08 * Math.sin(Math.PI * p);
      transformed(ctx, prev, { x: -W * e, scaleX: stretch, W, H });
      transformed(ctx, next, { x: W * (1 - e), scaleX: stretch, W, H });
    },
  },

  'whip-pan': {
    dur: 0.34,
    label: 'Whip pan — a blurred swing between subjects',
    paint(ctx, prev, next, p, { W, H }) {
      // Both layers are on screen through the middle — the outgoing is still leaving as the incoming
      // arrives. Handing over at exactly 0.5 leaves one empty frame, which reads as a dropped frame.
      const blur = Math.sin(Math.PI * p) * 9;
      const f = blur > 0.5 ? `blur(${blur.toFixed(2)}px)` : undefined;
      // Travel exactly one frame-width and overlap the windows: at every p the incoming frame's left
      // edge is at or behind the outgoing frame's right edge, so no band of bare matte is ever exposed.
      const out = easeInCubic(Math.min(1, p / 0.75));
      const inn = easeOutCubic(Math.max(0, (p - 0.25) / 0.75));
      transformed(ctx, next, { x: W * (1 - inn), scaleX: 1.06, filter: f, W, H });
      transformed(ctx, prev, { x: -W * out, scaleX: 1.06, filter: f, W, H });
    },
  },

  'polaroid-drop': {
    dur: 0.55,
    label: 'The incoming frame drops in and settles',
    paint(ctx, prev, next, p, { W, H }) {
      ctx.drawImage(prev, 0, 0);
      const e = easeOutBack(p);
      transformed(ctx, next, { y: -H * (1 - e), rotate: (1 - e) * 0.05, alpha: smoothstep(Math.min(1, p * 2)), W, H });
    },
  },

  // ── Wipes ──────────────────────────────────────────────────────────────────────────────────────
  'clean-line-wipe': {
    dur: 0.45,
    label: 'Hard-edged linear wipe',
    paint(ctx, prev, next, p, { W, H }) {
      ctx.drawImage(prev, 0, 0);
      clipped(ctx, next, (c) => c.rect(0, 0, W * easeInOutCubic(p), H));
    },
  },

  'edge-wipe-soft': {
    dur: 0.5,
    label: 'Soft-edged wipe — the seam is feathered',
    paint(ctx, prev, next, p, { W, H }) {
      ctx.drawImage(prev, 0, 0);
      // The feather is built on a SCRATCH canvas and then composited normally. Masking with
      // `destination-in` directly on the frame would erase `prev` and the matte underneath it — and the
      // reel pipes unpremultiplied RGBA into ffmpeg's yuv420p conversion, which discards alpha entirely,
      // so a "feather" left in the frame's alpha channel renders as a hard edge with a black fringe.
      const e = easeInOutCubic(p);
      const edge = W * (e * 1.3 - 0.15);
      const feather = W * 0.18;
      const scratch = scratchLike(ctx, W, H);
      const s = scratch.getContext('2d');
      s.drawImage(next, 0, 0);
      s.globalCompositeOperation = 'destination-in';
      const g = s.createLinearGradient(edge - feather, 0, edge + feather, 0);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      s.fillStyle = g;
      s.fillRect(0, 0, W, H);
      ctx.drawImage(scratch, 0, 0);
    },
  },

  'iris-circle': {
    dur: 0.55,
    label: 'Iris — the incoming frame opens from a point',
    paint(ctx, prev, next, p, { W, H }) {
      ctx.drawImage(prev, 0, 0);
      const r = Math.hypot(W, H) * 0.5 * smootherstep(p);
      clipped(ctx, next, (c) => c.arc(W / 2, H * 0.55, r, 0, Math.PI * 2));
    },
  },

  'iris-split': {
    dur: 0.55,
    label: 'Two irises open and meet',
    paint(ctx, prev, next, p, { W, H }) {
      ctx.drawImage(prev, 0, 0);
      const r = Math.hypot(W, H) * 0.42 * smootherstep(p);
      clipped(ctx, next, (c) => {
        c.arc(W * 0.3, H * 0.45, r, 0, Math.PI * 2);
        c.arc(W * 0.7, H * 0.62, r, 0, Math.PI * 2);
      });
    },
  },

  'mirror-split': {
    dur: 0.5,
    label: 'The outgoing frame splits apart down the middle',
    paint(ctx, prev, next, p, { W, H }) {
      ctx.drawImage(next, 0, 0);
      const e = easeInOutCubic(p);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W / 2, H);
      ctx.clip();
      ctx.drawImage(prev, -W * 0.5 * e, 0);
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.rect(W / 2, 0, W / 2, H);
      ctx.clip();
      ctx.drawImage(prev, W * 0.5 * e, 0);
      ctx.restore();
    },
  },

  'heart-wipe': {
    dur: 0.6,
    label: 'Heart-shaped reveal',
    paint(ctx, prev, next, p, { W, H }) {
      ctx.drawImage(prev, 0, 0);
      const s = smootherstep(p) * Math.hypot(W, H) * 0.06;
      clipped(ctx, next, (c) => {
        // Parametric heart, scaled about the frame centre.
        for (let i = 0; i <= 60; i++) {
          const a = (i / 60) * Math.PI * 2;
          const hx = 16 * Math.pow(Math.sin(a), 3);
          const hy = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
          const x = W / 2 + hx * s;
          const y = H * 0.52 + hy * s;
          if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
        }
        c.closePath();
      });
    },
  },

  // ── Physical (the outgoing frame is treated as an object) ──────────────────────────────────────
  flip: {
    dur: 0.5,
    label: 'Card flip — same object, other side',
    paint(ctx, prev, next, p, { W, H }) {
      // Scaling X about the centre is the honest 2D projection of a Y-axis rotation — no 3D matrix
      // needed, and the handover at the edge-on midpoint is where the eye expects it.
      const half = p < 0.5;
      const e = easeInOutCubic(half ? p * 2 : (p - 0.5) * 2);
      const sx = Math.max(0.001, half ? 1 - e : e);
      transformed(ctx, half ? prev : next, { scaleX: sx, pivotY: 0, W, H });
      veil(ctx, '#000000', 0.28 * (1 - Math.abs(p - 0.5) * 2), W, H);
    },
  },

  'spin-3d': {
    dur: 0.55,
    label: 'Spin — the frame swings past the camera and the next swings in',
    paint(ctx, prev, next, p, { W, H }) {
      // Distinct from `flip` on purpose. A flip is a card turning in PLACE; this one TRAVELS while it
      // turns and foreshortens as it goes — the near edge grows as the plane rotates toward the viewer,
      // and the incoming half swings in from the opposite side. Without the travel and the vertical
      // stretch the two transitions render as the same horizontal squeeze.
      const half = p < 0.5;
      const e = easeInOutCubic(half ? p * 2 : (p - 0.5) * 2);
      const sx = Math.max(0.001, half ? 1 - e : e);
      const dir = half ? -1 : 1;
      const edgeOn = 1 - sx; // 0 face-on → 1 edge-on
      transformed(ctx, half ? prev : next, {
        scaleX: sx,
        scaleY: 1 + 0.14 * edgeOn,
        x: dir * W * 0.22 * edgeOn,
        W, H,
      });
      veil(ctx, '#000000', 0.42 * (1 - Math.abs(p - 0.5) * 2), W, H);
    },
  },

  'page-peel': {
    dur: 0.6,
    label: 'The outgoing page peels away from the corner',
    paint(ctx, prev, next, p, { W, H }) {
      ctx.drawImage(next, 0, 0);
      const e = smoothstep(p);
      // `prev` must cover the WHOLE frame at p=0 and lose a growing corner — the old version clipped to
      // the upper-left triangle from the start, so half the frame cut to `next` on frame one.
      const reach = e * (W + H) * 1.15;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(W, 0);
      if (reach < W) {
        ctx.lineTo(W, H);
        ctx.lineTo(W - reach, H); // seam still climbing the bottom edge
      } else {
        ctx.lineTo(W, Math.max(0, H - (reach - W))); // seam now climbing the right edge
      }
      ctx.lineTo(Math.max(0, W - reach), H);
      ctx.lineTo(0, H);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(prev, 0, 0);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = 0.22 * (1 - Math.abs(p - 0.5) * 2);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = Math.max(2, W * 0.01);
      ctx.beginPath();
      ctx.moveTo(Math.max(0, W - reach), H);
      ctx.lineTo(W, Math.max(0, H - Math.max(0, reach - W)));
      ctx.stroke();
      ctx.restore();
    },
  },

  'tearing-paper': {
    dur: 0.65,
    label: 'The outgoing frame tears in two and parts',
    paint(ctx, prev, next, p, { W, H }) {
      ctx.drawImage(next, 0, 0);
      const e = easeInCubic(p);
      // One ragged seam, deterministic, shared by both halves so the tear matches.
      const seam = (y) => W / 2 + Math.sin(y / (H / 9)) * W * 0.035 + (rnd(Math.round(y / 24)) - 0.5) * W * 0.03;
      const half = (dir) => {
        ctx.save();
        ctx.beginPath();
        if (dir < 0) {
          ctx.moveTo(0, 0);
          for (let y = 0; y <= H; y += 12) ctx.lineTo(seam(y), y);
          ctx.lineTo(0, H);
        } else {
          ctx.moveTo(W, 0);
          for (let y = 0; y <= H; y += 12) ctx.lineTo(seam(y), y);
          ctx.lineTo(W, H);
        }
        ctx.closePath();
        ctx.clip();
        ctx.translate(dir * W * 0.6 * e, 0);
        ctx.rotate(dir * 0.05 * e);
        ctx.drawImage(prev, 0, 0);
        ctx.restore();
      };
      half(-1);
      half(1);
    },
  },

  // ── Light (blend-mode overlays) ────────────────────────────────────────────────────────────────
  'light-leak-wipe': {
    dur: 0.6,
    label: 'A warm light leak sweeps the cut',
    paint(ctx, prev, next, p, { W, H }) {
      ctx.drawImage(prev, 0, 0);
      ctx.globalAlpha = smoothstep(p);
      ctx.drawImage(next, 0, 0);
      ctx.globalAlpha = 1;
      const x = W * (-0.2 + 1.4 * p);
      const g = ctx.createLinearGradient(x - W * 0.35, 0, x + W * 0.35, H);
      g.addColorStop(0, 'rgba(255,170,90,0)');
      g.addColorStop(0.5, 'rgba(255,196,130,0.75)');
      g.addColorStop(1, 'rgba(255,170,90,0)');
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = Math.sin(Math.PI * p);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    },
  },

  'glare-sweep': {
    dur: 0.5,
    label: 'A lens-flare streak crosses the cut',
    paint(ctx, prev, next, p, { W, H }) {
      ctx.drawImage(prev, 0, 0);
      ctx.globalAlpha = smoothstep(p);
      ctx.drawImage(next, 0, 0);
      ctx.globalAlpha = 1;
      const x = W * (-0.3 + 1.6 * p);
      const g = ctx.createLinearGradient(x - W * 0.12, 0, x + W * 0.12, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.9)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = softPeak(p) * 0.8;
      ctx.translate(W / 2, H / 2);
      ctx.rotate(-0.35);
      ctx.translate(-W / 2, -H / 2);
      ctx.fillStyle = g;
      ctx.fillRect(-W, 0, W * 3, H);
      ctx.restore();
    },
  },

  'floodlight-sweep': {
    dur: 0.6,
    label: 'A warm stage light swells across the cut',
    paint(ctx, prev, next, p, { W, H }) {
      ctx.drawImage(prev, 0, 0);
      ctx.globalAlpha = smoothstep(p);
      ctx.drawImage(next, 0, 0);
      ctx.globalAlpha = 1;
      const g = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, Math.hypot(W, H) * 0.6);
      g.addColorStop(0, 'rgba(255,214,160,0.85)');
      g.addColorStop(1, 'rgba(255,214,160,0)');
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = softPeak(p) * 0.7;
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    },
  },

  'clouds-wipe': {
    dur: 0.7,
    label: 'Soft billows part to reveal',
    paint(ctx, prev, next, p, { W, H }) {
      ctx.drawImage(prev, 0, 0);
      const e = smootherstep(p);
      // Procedural billows: deterministic blobs growing along a rising front.
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i < 26; i++) {
        const bx = rnd(i) * W;
        const by = H * (1.15 - e * 1.35) + rnd(i + 99) * H * 0.22;
        const r = (0.10 + rnd(i + 7) * 0.12) * W * (0.5 + e);
        ctx.moveTo(bx + r, by);
        ctx.arc(bx, by, r, 0, Math.PI * 2);
      }
      ctx.rect(0, H * (1.15 - e * 1.35) + H * 0.2, W, H);
      ctx.clip();
      ctx.drawImage(next, 0, 0);
      ctx.restore();
    },
  },

  // ── Texture ────────────────────────────────────────────────────────────────────────────────────
  'glitch-cut': {
    dur: 0.36,
    label: 'RGB split + scanlines — a deliberate digital break',
    paint(ctx, prev, next, p, { W, H }) {
      const base = p < 0.5 ? prev : next;
      // Gaussian bell centred slightly before the midpoint, as in the original.
      const amt = Math.exp(-Math.pow((p - 0.45) / 0.18, 2) / 2);
      const off = amt * W * 0.012;
      ctx.drawImage(base, 0, 0);
      if (amt > 0.02) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.5 * amt;
        ctx.drawImage(base, -off, 0);
        ctx.drawImage(base, off, 0);
        ctx.restore();
        // Horizontal tear bands.
        for (let i = 0; i < 5; i++) {
          const y = rnd(i + Math.round(p * 8)) * H;
          const h = H * 0.02;
          ctx.drawImage(base, 0, y, W, h, (rnd(i + 3) - 0.5) * off * 4, y, W, h);
        }
        // Scanlines.
        ctx.save();
        ctx.globalCompositeOperation = 'overlay';
        ctx.globalAlpha = 0.25 * amt;
        ctx.fillStyle = '#000000';
        for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 2);
        ctx.restore();
      }
    },
  },
};

/**
 * Deterministic rotation for projects that don't art-direct each cut. Mostly plain on purpose: the
 * expressive entries appear rarely and never twice in a row.
 */
const AUTO_CYCLE = [
  'cut', 'cut', 'dissolve', 'cut', 'push', 'cut', 'cinematic-dissolve', 'cut',
  'cut', 'glare-sweep', 'cut', 'dissolve',
];

/** Resolve a cut id (`auto` picks from the rotation by scene index), with a helpful error. */
/** Ids kept for compatibility that resolve to another entry (deduplicated moves). */
const ALIASES = { 'clean-circle-wipe': 'iris-circle' };

export function transitionFor(id, index = 0) {
  id = ALIASES[id] || id;
  const key = id === 'auto' ? AUTO_CYCLE[index % AUTO_CYCLE.length] : id || 'cut';
  const t = TRANSITIONS[key];
  if (!t) {
    throw new Error(`Unknown cut "${id}". Available: ${Object.keys(TRANSITIONS).join(', ')}, auto.`);
  }
  return t;
}

/** Every cut id, for `zdymak specs` and docs. */
export const TRANSITION_IDS = Object.keys(TRANSITIONS);
