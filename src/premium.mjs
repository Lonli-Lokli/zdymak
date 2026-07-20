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
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { font, hexA, hexRgb, springSeries, roundRectPath, fillVerticalGradient, radialGlow, wrapLines } from './canvas.mjs';

const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.min(1, Math.max(0, t));

/** Defaults — brand-driven where a value is null (resolved in buildPremium against `brand`). */
const DEFAULT_THEME = {
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
};

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

  const titleSize = Math.round(W * 0.05);
  const subSize = Math.round(W * 0.033);
  const cx = W / 2;
  let y = H * 0.855;

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
    y += pillH / 2 + subSize * 1.4;
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

/** Build one premium-technique video. Signature mirrors buildVideo/buildReel. */
export async function buildPremium({ scenes, spec, brand, theme, outFile, sceneDur = 3.0 }) {
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
  const args = [
    '-y', '-loglevel', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(fps), '-i', '-',
    '-c:v', 'libx264', '-profile:v', spec.profile, '-level:v', spec.level,
    '-pix_fmt', 'yuv420p', '-crf', '17', '-maxrate', '12M', '-bufsize', '12M',
    '-preset', 'slow', '-r', String(fps), '-movflags', '+faststart', '-an',
    outFile,
  ];
  const proc = spawn(process.env.FFMPEG || 'ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => {
    proc.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}`))));
    proc.on('error', (e) => rej(new Error(`ffmpeg failed to start (${e.message}). Is ffmpeg on PATH or $FFMPEG set?`)));
  });

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
