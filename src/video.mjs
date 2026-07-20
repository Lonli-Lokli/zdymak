/**
 * The video engine — turns a list of screenshots + captions into a premium, spec-compliant store preview.
 *
 * Motion is deliberately cinematic, not a flat slideshow (technique study of production Apple-style reels):
 *   • Camera = an OVER-DAMPED SPRING that eases toward the screen and SETTLES (velocity→0) — a dolly, not
 *     a constant-rate Ken-Burns zoom. Each scene MOVES for ~1s then HOLDS ("cut on motion, rest on it").
 *   • Motion VARIES per scene (push-in / pull-back / vertical & lateral drift) so no effect repeats.
 *   • Captions live OUTSIDE the camera transform — steady while the screen drifts behind them (parallax),
 *     and animate in with a small spring rise+fade (kinetic typography).
 *
 * Output is full-bleed (no device bezel — Apple rejects bezels in App Previews) at the target's exact
 * resolution, H.264 High @ the target's level, yuv420p, faststart, silent.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.min(1, Math.max(0, t));

/** Numerically integrated damped spring 0→1 (semi-implicit Euler) → per-frame lookup array. Over-damped
 *  configs glide and settle (camera); lighter damping gives a small overshoot (caption pop). */
function springSeries(frames, fps, { stiffness = 55, damping = 24, mass = 1.5 } = {}) {
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

/** Per-scene camera transform at spring-progress p∈[0,1]. Drifts carry a base zoom so the screen still
 *  covers the frame when translated (no empty edge). Gentle by design (≤8% scale, ≤18px). */
function motion(kind, p) {
  switch (kind) {
    case 'pushInSlow': return { scale: lerp(1.0, 1.08, p), tx: 0, ty: 0 };
    case 'pushIn': return { scale: lerp(1.0, 1.06, p), tx: 0, ty: 0 };
    case 'pullBack': return { scale: lerp(1.08, 1.0, p), tx: 0, ty: 0 };
    case 'pullBackSlow': return { scale: lerp(1.07, 1.0, p), tx: 0, ty: 0 };
    case 'driftUp': return { scale: 1.06, tx: 0, ty: lerp(16, -16, p) };
    case 'driftDown': return { scale: 1.06, tx: 0, ty: lerp(-16, 16, p) };
    case 'driftRight': return { scale: 1.06, tx: lerp(-16, 16, p), ty: 0 };
    case 'driftLeft': return { scale: 1.06, tx: lerp(16, -16, p), ty: 0 };
    case 'still': return { scale: 1.0, tx: 0, ty: 0 };
    default: return { scale: lerp(1.0, 1.06, p), tx: 0, ty: 0 }; // sensible default = gentle push-in
  }
}

/** A rotation of moves so a project that doesn't specify per-scene motion still gets varied rhythm. */
const AUTO_MOVES = ['pushInSlow', 'driftUp', 'pullBack', 'pushIn', 'driftRight', 'pushIn', 'pullBackSlow'];

/** Cover-fit a source image to fill W×H (crop the tiny overflow) — full-bleed, no letterbox. */
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

const font = (size, weight = 'bold') => `${weight} ${size}px Brand`;

/** Word-wrap `text` to at most `maxWidth`, returning the line array (ctx.font must already be set). */
function wrapLines(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Draw the legibility scrim + caption at a FIXED position (never touched by the camera transform). */
function drawCaptionLayer(ctx, W, H, caption, brand, alpha, rise) {
  if (alpha <= 0.001 || (!caption.title && !caption.sub)) return;
  ctx.save();
  ctx.globalAlpha = alpha;

  // Bottom scrim: transparent → deep ink over the lower half, only where the caption sits.
  const g = ctx.createLinearGradient(0, H * 0.5, 0, H);
  g.addColorStop(0, hexA(brand.ink, 0));
  g.addColorStop(0.55, hexA(brand.ink, 0.55));
  g.addColorStop(1, hexA(brand.ink, 0.9));
  ctx.fillStyle = g;
  ctx.fillRect(0, H * 0.5, W, H * 0.5);

  const titleSize = Math.round(W * 0.066); // 58 @ 886
  const subSize = Math.round(W * 0.036); //   32 @ 886
  const maxWidth = W * 0.86;
  const cx = W / 2;
  let y = H * 0.75 + rise;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  if (caption.title) {
    ctx.font = font(titleSize, 'bold');
    ctx.fillStyle = brand.title;
    for (const line of wrapLines(ctx, caption.title, maxWidth)) {
      ctx.fillText(line, cx, y);
      y += Math.round(titleSize * 1.12);
    }
  }
  if (caption.sub) {
    y += Math.round(titleSize * 0.18);
    ctx.font = font(subSize, 'regular');
    ctx.fillStyle = brand.sub;
    for (const line of wrapLines(ctx, caption.sub, maxWidth)) {
      ctx.fillText(line, cx, y);
      y += Math.round(subSize * 1.3);
    }
  }
  ctx.restore();
}

/** #rrggbb + alpha → rgba() string. */
function hexA(hex, a) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function resolveFfmpeg() {
  return process.env.FFMPEG || 'ffmpeg';
}

/**
 * Build one preview video.
 * @param {object}   o
 * @param {Array}    o.scenes    [{ image: <path>, title?, sub?, move? }]
 * @param {object}   o.spec      one VIDEO_TARGETS entry (w,h,fps,profile,level,minSec,maxSec,label)
 * @param {object}   o.brand     { ink, title, sub }  (hex colours)
 * @param {string}   o.outFile   absolute path to write the .mp4
 * @param {number}  [o.sceneDur=3.1]  seconds each scene holds
 * @param {number}  [o.xfade=0.32]    cross-dissolve seconds
 * @returns {Promise<{outFile, totalDur, frames, warnings}>}
 */
export async function buildVideo({ scenes, spec, brand, outFile, sceneDur = 3.1, xfade = 0.32 }) {
  if (!scenes?.length) throw new Error('buildVideo: no scenes');
  const { w: W, h: H, fps } = spec;
  const warnings = [];

  // Springs: one slow cinematic glide for the camera, one lively rise for captions.
  const camFrames = Math.ceil(sceneDur * fps) + 2;
  const CAM = springSeries(camFrames, fps, { stiffness: 55, damping: 24, mass: 1.5 });
  const CAP = springSeries(Math.ceil(0.9 * fps) + 2, fps, { stiffness: 120, damping: 18, mass: 1 });
  const camAt = (t) => CAM[Math.min(CAM.length - 1, Math.max(0, Math.round(t * fps)))];
  const capAt = (t) => CAP[Math.min(CAP.length - 1, Math.max(0, Math.round(t * fps)))];

  // Load + full-bleed each screenshot; assign a varied move if the scene didn't specify one.
  const clips = [];
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    if (!fs.existsSync(s.image)) throw new Error(`Screenshot not found: ${s.image}`);
    const img = await loadImage(s.image);
    clips.push({
      screen: coverCanvas(img, W, H),
      caption: { title: s.title || '', sub: s.sub || '' },
      move: s.move || AUTO_MOVES[i % AUTO_MOVES.length],
      dur: sceneDur,
    });
  }

  const starts = [0];
  let acc = 0;
  for (let i = 0; i < clips.length - 1; i++) {
    acc += clips[i].dur - xfade;
    starts.push(acc);
  }
  const totalDur = starts[starts.length - 1] + clips[clips.length - 1].dur;
  const totalFrames = Math.round(totalDur * fps);

  if (spec.minSec && totalDur < spec.minSec) {
    warnings.push(`Duration ${totalDur.toFixed(1)}s is under ${spec.store} minimum ${spec.minSec}s — add scenes or raise sceneDur.`);
  }
  if (spec.maxSec && totalDur > spec.maxSec) {
    warnings.push(`Duration ${totalDur.toFixed(1)}s exceeds ${spec.store} maximum ${spec.maxSec}s — drop scenes or lower sceneDur.`);
  }

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
  const proc = spawn(resolveFfmpeg(), args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => {
    proc.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}`))));
    proc.on('error', (e) => rej(new Error(`ffmpeg failed to start (${e.message}). Is ffmpeg on PATH or $FFMPEG set?`)));
  });

  for (let k = 0; k < totalFrames; k++) {
    const t = k / fps;
    fctx.clearRect(0, 0, W, H);
    fctx.fillStyle = brand.ink;
    fctx.fillRect(0, 0, W, H);

    for (let i = 0; i < clips.length; i++) {
      const start = starts[i];
      const end = start + clips[i].dur;
      if (t < start || t >= end) continue;
      const localT = t - start;
      const clipAlpha = i > 0 && localT < xfade ? smooth(localT / xfade) : 1;

      // Camera: spring-eased move that settles then holds. Captions are NOT under this transform.
      const { scale, tx, ty } = motion(clips[i].move, camAt(localT));
      fctx.save();
      fctx.globalAlpha = clipAlpha;
      fctx.translate(W / 2 + tx, H / 2 + ty);
      fctx.scale(scale, scale);
      fctx.translate(-W / 2, -H / 2);
      fctx.drawImage(clips[i].screen, 0, 0);
      fctx.restore();

      // Caption: kinetic rise+fade in over ~0.5s; gentle fade-out before the cut.
      const inA = smooth(clamp01((localT - 0.12) / 0.5));
      const rise = (1 - capAt(Math.max(0, localT - 0.12))) * 26;
      const outA = smooth(clamp01((clips[i].dur - localT) / 0.4));
      drawCaptionLayer(fctx, W, H, clips[i].caption, brand, clipAlpha * inA * outA, rise);
    }

    const buf = Buffer.from(fctx.getImageData(0, 0, W, H).data.buffer);
    if (!proc.stdin.write(buf)) {
      await new Promise((r) => proc.stdin.once('drain', r));
    }
  }
  proc.stdin.end();
  await done;
  return { outFile, totalDur, frames: totalFrames, warnings };
}
