/**
 * The PREMIUM technique — the Apple-marketing editing vocabulary (as codified in production
 * "Apple-Vision-Pro-reel" ad pipelines), generalized and fully themeable.
 *
 * Effects applied (all tunable via `theme`, sensible brand-driven defaults if unset):
 *   • One-device MATTE — every screen floats, gently inset, on a constant brand matte + soft radial glow,
 *     so N different screens read as "one device, many apps" (the Apple ecosystem-reel look).
 *   • VIGNETTE — subtle edge darkening for depth.
 *   • Motion-then-FREEZE — an over-damped spring dolly that moves ~1s then holds ("cut on motion, rest").
 *   • PALETTE-AWARE cuts — a near-hard cut between screens that share a palette, a soft dissolve only at a
 *     palette shift (no decorative transitions — the #1 amateur tell).
 *   • Label PILL — the scene title on a soft rounded pill (Apple's launch-montage app labels); optional
 *     brand HANDLE along the top.
 *
 * Output is full-bleed frame at the target resolution (the app screen itself is inset on the matte, but no
 * device bezel), H.264 High @ the target level, yuv420p, silent.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { font, hexA, hexRgb, springSeries, roundRectPath, fillVerticalGradient, radialGlow, wrapLines } from './canvas.mjs';
import { spawnEncoder } from './encode.mjs';
import { frameFor } from './frames.mjs';

const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.min(1, Math.max(0, t));

/** Defaults — brand-driven where a value is null (resolved in buildPremium against `brand`). */
export const DEFAULT_THEME = {
  bgTop: '#17161c', // matte gradient top
  bgBottom: '#0b0b0a', // matte gradient bottom
  glow: null, // radial brand glow colour → defaults to brand.sub
  glowAlpha: 0.16,
  vignette: 0.3, // 0..1 edge darkening strength
  inset: 0.955, // screen fills this fraction of the frame width (thin matte border)
  radius: 0.03, // screen corner radius as a fraction of frame width
  shadow: 0.42, // floating-screen drop-shadow alpha
  label: true, // show the bottom title pill
  pillFill: null, // → brand.ink
  pillOpacity: 0.9,
  labelColor: null, // → brand.title
  subColor: null, // → brand.sub
  handle: null, // optional persistent top handle text (e.g. '@yourapp')
  cutHard: 0.05, // dissolve seconds when adjacent screens share a palette (≈ hard cut)
  cutSoft: 0.24, // dissolve seconds at a palette shift
  cutThreshold: 42, // RGB-distance above which a boundary counts as a palette shift
  captionAnchor: 'bottom', // 'top' places the caption above the device (the bright store-shot layout)
  fit: 'cover', // screenLayer image fit: 'cover' (fill + crop) | 'contain' (whole capture, matte margins)
};

/** The `theme`/`stillTheme` options an app author is expected to set — the doc-sync guard
 *  (`scripts/check-docs.mjs`) asserts each appears in README.md/SKILL.md, so adding a public knob forces a
 *  doc line. (The rest of DEFAULT_THEME — radius, shadow, the pill and cut knobs — are advanced/internal
 *  and not enforced.) */
export const PUBLIC_THEME_KEYS = [
  'bgTop', 'bgBottom', 'glow', 'glowAlpha', 'vignette', 'inset',
  'label', 'labelColor', 'subColor', 'handle', 'captionAnchor', 'fit',
  'headlineScale', 'frame', 'bleed',
];

/** Average RGB of a canvas (coarse grid sample) — used to decide hard-cut vs dissolve. */
function avgColor(canvas) {
  const { width: w, height: h } = canvas;
  const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const step = Math.max(1, Math.floor((w * h) / 4000)) * 4; // ~4k samples
  for (let i = 0; i < data.length; i += step) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }
  return [r / n, g / n, b / n];
}
const colorDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Full-bleed cover of a source image onto a W×H canvas (crop tiny overflow). */
function coverCanvas(img, W, H) {
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  const ia = img.height / img.width;
  let dw = W;
  let dh = W * ia;
  if (dh < H) {
    dh = H;
    dw = H / ia;
  }
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  return c;
}

/** Paint the matte background (gradient + radial brand glow) onto the frame ctx. */
function paintMatte(ctx, W, H, th) {
  fillVerticalGradient(ctx, W, H, th.bgTop, th.bgBottom);
  radialGlow(ctx, W * 0.5, H * 0.4, W * 0.85, th.glow, th.glowAlpha);
}

/** Radial vignette (transparent centre → dark edges) over the whole frame. */
function paintVignette(ctx, W, H, strength) {
  if (strength <= 0) return;
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** Bottom title pill + subtitle (Apple launch-montage label), fixed position, own fade. */
function drawLabel(ctx, W, H, caption, th, alpha) {
  if (alpha <= 0.01 || (!caption.title && !caption.sub)) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Scale type to the SHORTER edge so landscape (Mac) doesn't get huge text, and anchor high enough that
  // the pill + subtitle never clip the bottom on wide aspects.
  const titleSize = Math.round(Math.min(W, H * 0.9) * (th.headlineScale ?? 0.062)); // bolder headline (top listings go big)
  const subSize = Math.round(Math.min(W, H * 0.9) * 0.033);
  const cx = W / 2;
  // Bottom by default (anchored higher on wide/landscape so the pill clears the app's own bottom UI);
  // captionAnchor:'top' puts it above the device — the bright store-shot layout.
  const topCaption = th.captionAnchor === 'top';
  let y = topCaption ? H * 0.085 : (W > H ? 0.7 : 0.82) * H;

  if (caption.title && th.label) {
    ctx.font = font(titleSize, 'bold');
    const tw = ctx.measureText(caption.title).width;
    const padX = Math.round(titleSize * 0.7);
    const padY = Math.round(titleSize * 0.42);
    const pillW = tw + padX * 2;
    const pillH = titleSize + padY * 2;
    roundRectPath(ctx, cx - pillW / 2, y - pillH / 2, pillW, pillH, pillH / 2);
    ctx.fillStyle = hexA(th.pillFill, th.pillOpacity);
    ctx.fill();
    ctx.fillStyle = th.labelColor;
    ctx.fillText(caption.title, cx, y + 1);
    y += pillH / 2 + subSize * 1.05;
  } else if (caption.title) {
    ctx.font = font(titleSize, 'bold');
    ctx.fillStyle = th.labelColor;
    ctx.fillText(caption.title, cx, y);
    y += titleSize * 0.9 + subSize * 1.2;
  }

  if (caption.sub) {
    ctx.font = font(subSize, 'regular');
    ctx.fillStyle = th.subColor;
    for (const ln of wrapLines(ctx, caption.sub, W * 0.82)) {
      ctx.fillText(ln, cx, y);
      y += subSize * 1.3;
    }
  }
  ctx.restore();
}

/** Persistent top handle (optional brand chrome). */
function drawHandle(ctx, W, H, text, color) {
  if (!text) return;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font(Math.round(W * 0.03), 'semibold');
  ctx.fillStyle = hexA(color, 0.9);
  ctx.fillText(text, W / 2, H * 0.035);
  ctx.restore();
}

/** Resolve theme defaults against the brand (shared by the video + still renderers). */
export function resolvePremiumTheme(brand, theme) {
  const th = { ...DEFAULT_THEME, ...(theme || {}) };
  th.glow = th.glow || brand.sub;
  th.pillFill = th.pillFill || brand.ink;
  th.labelColor = th.labelColor || brand.title;
  th.subColor = th.subColor || brand.sub;
  th.handle = th.handle ?? brand.handle ?? null;
  return th;
}

/** The floating, inset, rounded, shadowed app-screen layer on its own transparent canvas.
 *  fit 'cover' fills the inset box (crops overflow); fit 'contain' shows the WHOLE capture — the card
 *  shrinks to the capture's aspect and floats with matte margins (correct for a Mac window on the matte,
 *  where a cover-crop would slice off the title bar / traffic lights). */
function screenLayer(W, H, img, th) {
  // Reserve headroom for a top caption so the window floats BELOW it (else it covers the headline).
  const topCaption = th.captionAnchor === 'top';
  const bandTop = topCaption ? H * 0.18 : 0;
  const bandH = (topCaption ? 0.8 : 1) * H;
  const boxW = Math.round(W * th.inset);
  const boxH = Math.round(bandH * th.inset);
  const ia = img.height / img.width;
  let dw = boxW;
  let dh = boxH;
  if (th.fit === 'contain') {
    dh = boxW * ia; // fit width, then clamp height so the whole capture fits the box
    if (dh > boxH) {
      dh = boxH;
      dw = boxH / ia;
    }
  }
  const dx = Math.round((W - dw) / 2);
  const dy = Math.round(bandTop + (bandH - dh) / 2);
  const radius = Math.round(W * th.radius);
  const layer = createCanvas(W, H);
  const lctx = layer.getContext('2d');
  lctx.save();
  lctx.shadowColor = `rgba(0,0,0,${th.shadow})`;
  lctx.shadowBlur = Math.round(W * 0.05);
  lctx.shadowOffsetY = Math.round(W * 0.012);
  roundRectPath(lctx, dx, dy, dw, dh, radius);
  lctx.fillStyle = '#000';
  lctx.fill();
  lctx.restore();
  lctx.save();
  roundRectPath(lctx, dx, dy, dw, dh, radius);
  lctx.clip();
  // The card now matches the draw aspect, so cover here fills it exactly (no crop for 'contain').
  lctx.drawImage(coverCanvas(img, dw, dh), dx, dy);
  lctx.restore();
  return layer;
}

/** Render ONE premium still → canvas. Static, no motion. With `frame` (phone|ipad|watch) the screen is
 *  drawn inside a device bezel floating on the matte; otherwise it's the plain rounded inset. */
export function premiumStill({ W, H, img, caption, brand, theme, frame }) {
  const th = resolvePremiumTheme(brand, theme);
  // Store-shot smart defaults (each overridable via `theme`): headline sits ON TOP; a frameless window
  // (e.g. Mac) shows the WHOLE capture instead of cropping its title bar.
  if (theme?.captionAnchor === undefined) th.captionAnchor = 'top';
  if (!frame && theme?.fit === undefined) th.fit = 'contain';
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  paintMatte(ctx, W, H, th);

  const topCaption = th.captionAnchor === 'top';
  const drawFrame = frame ? frameFor(frame) : null;
  if (drawFrame) {
    const cy = H * (topCaption ? 0.57 : 0.42); // drop the device when the caption sits on top
    if (frame === 'watch') {
      drawFrame(ctx, img, W / 2, cy, Math.min(W, H) * 0.6);
    } else {
      const budgetH = H * (topCaption ? 0.66 : 0.64); // vertical room for the device body
      const screenW = Math.min(budgetH / (img.height / img.width), W * 0.8);
      drawFrame(ctx, img, W / 2, cy, screenW);
    }
  } else {
    ctx.drawImage(screenLayer(W, H, img, th), 0, 0);
  }

  drawLabel(ctx, W, H, caption, th, 1);
  paintVignette(ctx, W, H, th.vignette);
  drawHandle(ctx, W, H, th.handle, th.labelColor);
  return c;
}

/** Build one premium-technique video. Signature mirrors buildVideo/buildReel. */
export async function buildPremium({ scenes, spec, brand, theme, outFile, sceneDur = 3.0, music }) {
  if (!scenes?.length) throw new Error('buildPremium: no scenes');
  const { w: W, h: H, fps } = spec;
  const th = { ...DEFAULT_THEME, ...(theme || {}) };
  th.glow = th.glow || brand.sub;
  th.pillFill = th.pillFill || brand.ink;
  th.labelColor = th.labelColor || brand.title;
  th.subColor = th.subColor || brand.sub;
  th.handle = th.handle ?? brand.handle ?? null;

  const CAM = springSeries(Math.ceil(sceneDur * fps) + 2, fps, { stiffness: 55, damping: 24, mass: 1.5 });
  const camAt = (t) => CAM[Math.min(CAM.length - 1, Math.max(0, Math.round(t * fps)))];

  const insetW = Math.round(W * th.inset);
  const insetH = Math.round(H * th.inset);
  const insetX = Math.round((W - insetW) / 2);
  const insetY = Math.round((H - insetH) / 2);
  const radius = Math.round(W * th.radius);

  // Pre-render each scene's floating screen (cover-fit into the inset rect) onto its own transparent layer.
  const clips = [];
  for (const s of scenes) {
    if (!fs.existsSync(s.image)) throw new Error(`Screenshot not found: ${s.image}`);
    const img = await loadImage(s.image);
    const layer = createCanvas(W, H);
    const lctx = layer.getContext('2d');
    // soft drop shadow
    lctx.save();
    lctx.shadowColor = `rgba(0,0,0,${th.shadow})`;
    lctx.shadowBlur = Math.round(W * 0.05);
    lctx.shadowOffsetY = Math.round(W * 0.012);
    roundRectPath(lctx, insetX, insetY, insetW, insetH, radius);
    lctx.fillStyle = '#000';
    lctx.fill();
    lctx.restore();
    // clip + draw the cover-fit screenshot
    lctx.save();
    roundRectPath(lctx, insetX, insetY, insetW, insetH, radius);
    lctx.clip();
    lctx.drawImage(coverCanvas(img, insetW, insetH), insetX, insetY);
    lctx.restore();
    clips.push({ layer, caption: { title: s.title || '', sub: s.sub || '' }, dur: sceneDur, avg: avgColor(layer) });
  }

  // Palette-aware per-boundary cut durations.
  const xfadeIn = clips.map((c, i) => {
    if (i === 0) return 0;
    return colorDist(clips[i - 1].avg, c.avg) < th.cutThreshold ? th.cutHard : th.cutSoft;
  });
  const starts = [0];
  for (let i = 1; i < clips.length; i++) starts.push(starts[i - 1] + clips[i - 1].dur - xfadeIn[i]);
  const totalDur = starts[starts.length - 1] + clips[clips.length - 1].dur;
  const totalFrames = Math.round(totalDur * fps);

  const frame = createCanvas(W, H);
  const fctx = frame.getContext('2d');

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const { proc, done } = spawnEncoder({ W, H, fps, spec, outFile, music, totalDur });

  for (let k = 0; k < totalFrames; k++) {
    const t = k / fps;
    // Matte + glow every frame (screens float over it).
    paintMatte(fctx, W, H, th);

    for (let i = 0; i < clips.length; i++) {
      const start = starts[i];
      const end = start + clips[i].dur;
      if (t < start || t >= end) continue;
      const localT = t - start;
      const clipAlpha = i > 0 && localT < xfadeIn[i] ? smooth(localT / xfadeIn[i]) : 1;

      // Motion-then-freeze: alternating spring push-in / pull-back, settles then holds.
      const p = camAt(localT);
      const z = i % 2 === 0 ? lerp(1.0, 1.05, p) : lerp(1.05, 1.0, p);
      fctx.save();
      fctx.globalAlpha = clipAlpha;
      fctx.translate(W / 2, H / 2);
      fctx.scale(z, z);
      fctx.translate(-W / 2, -H / 2);
      fctx.drawImage(clips[i].layer, 0, 0);
      fctx.restore();

      // Label (kinetic fade in, gentle fade before the cut) — not under the camera transform.
      const inA = smooth(clamp01((localT - 0.1) / 0.45));
      const outA = smooth(clamp01((clips[i].dur - localT) / 0.35));
      drawLabel(fctx, W, H, clips[i].caption, th, clipAlpha * inA * outA);
    }

    paintVignette(fctx, W, H, th.vignette);
    drawHandle(fctx, W, H, th.handle, th.labelColor);

    const buf = Buffer.from(fctx.getImageData(0, 0, W, H).data.buffer);
    if (!proc.stdin.write(buf)) {
      await new Promise((r) => proc.stdin.once('drain', r));
    }
  }
  proc.stdin.end();
  await done;
  return { outFile, totalDur, frames: totalFrames, warnings: [] };
}
