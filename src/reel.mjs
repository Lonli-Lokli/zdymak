/**
 * The REEL engine — a device-FRAMED, Apple-style "one phone, many apps" promo video for the web, social,
 * and (via YouTube) Google Play. This is intentionally NOT an App Store App Preview: it draws an iPhone
 * bezel + brand background + logo bookends, which Apple rejects in the App Preview slot. Use `video.mjs`
 * (full-bleed) for App Previews and this for marketing reels.
 *
 * Composition (ported from a production store-asset pipeline): a captioned phone on a soft brand wash,
 * gentle alternating Ken-Burns + cross-dissolves, bookended by a logo cold-open and end-card on a dark
 * matte. Silent by default (commercial-music licensing is a hard rule).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { font, hexA, roundRectPath, fillVerticalGradient, radialGlow, drawCaption, measureCaption } from './canvas.mjs';

const DEVICE_ASPECT = 2.165; // iPhone screen height/width (~19.5:9); screenshots are cover-fit into it.

/** Default reel palette — a calm green/stone brand. Override any key via `brand.reel` in the config. */
const DEFAULT_REEL = {
  bgTop: '#FAFAF9', bgBottom: '#DCFCE7', glowLight: '#BBF7D0', // soft light wash for the screen scenes
  matteTop: '#052E16', matteBottom: '#0b0b0a', glowDark: '#16A34A', // dark matte for cold-open / end-card
  titleColor: '#1C1917', subColor: '#78716C', // captions on the light wash
  bookendTitle: '#FAFAF9', bookendSub: '#BBF7D0', // text on the dark matte
};

const DEFAULT_TIMING = { coldOpen: 1.4, scene: 2.6, endCard: 2.4, xfade: 0.45 };

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const smooth = (t) => t * t * (3 - 2 * t);

function backgroundLight(ctx, W, H, p) {
  fillVerticalGradient(ctx, W, H, p.bgTop, p.bgBottom);
  radialGlow(ctx, W * 0.5, H * 0.34, W * 0.85, p.glowLight, 0.5);
}
function backgroundDark(ctx, W, H, p) {
  fillVerticalGradient(ctx, W, H, p.matteTop, p.matteBottom);
  radialGlow(ctx, W * 0.5, H * 0.42, W * 0.8, p.glowDark, 0.28);
}

/** Draw a clean modern iPhone (dark unibody, thin bezel, centred Dynamic Island) with `screen` cover-fit
 *  into the display. Geometry scales with `screenW`. */
function drawPhone(ctx, screen, cx, cy, screenW) {
  const screenH = screenW * DEVICE_ASPECT;
  const bezel = Math.round(screenW * 0.032);
  const bodyW = screenW + bezel * 2;
  const bodyH = screenH + bezel * 2;
  const bodyX = Math.round(cx - bodyW / 2);
  const bodyY = Math.round(cy - bodyH / 2);
  const screenX = bodyX + bezel;
  const screenY = bodyY + bezel;
  const bodyR = Math.round(screenW * 0.155);
  const screenR = Math.round(screenW * 0.135);

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.38)';
  ctx.shadowBlur = Math.round(screenW * 0.09);
  ctx.shadowOffsetY = Math.round(screenW * 0.035);
  roundRectPath(ctx, bodyX, bodyY, bodyW, bodyH, bodyR);
  ctx.fillStyle = '#0b0b0a';
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRectPath(ctx, bodyX + 1, bodyY + 1, bodyW - 2, bodyH - 2, bodyR - 1);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.stroke();
  ctx.restore();

  ctx.save();
  roundRectPath(ctx, screenX, screenY, screenW, screenH, screenR);
  ctx.clip();
  const sAspect = screen.height / screen.width;
  let dw = screenW;
  let dh = screenW * sAspect;
  if (dh < screenH) {
    dh = screenH;
    dw = screenH / sAspect;
  }
  ctx.drawImage(screen, screenX + (screenW - dw) / 2, screenY + (screenH - dh) / 2, dw, dh);
  ctx.restore();

  // Dynamic Island pill.
  const islandW = Math.round(screenW * 0.3);
  const islandH = Math.round(screenW * 0.085);
  roundRectPath(ctx, Math.round(screenX + (screenW - islandW) / 2), Math.round(screenY + bezel * 1.1), islandW, islandH, islandH / 2);
  ctx.fillStyle = '#050505';
  ctx.fill();

  return { bodyY, bodyH };
}

/** Icon + wordmark centred at (cx, y). */
function drawLockup(ctx, logo, cx, y, iconSize, textSize, name, color) {
  ctx.font = font(textSize, 'bold');
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const gap = Math.round(iconSize * 0.32);
  const textW = ctx.measureText(name).width;
  const hasIcon = !!logo;
  const total = (hasIcon ? iconSize + gap : 0) + textW;
  const x = cx - total / 2;
  if (hasIcon) {
    ctx.save();
    roundRectPath(ctx, x, y - iconSize / 2, iconSize, iconSize, iconSize * 0.22);
    ctx.clip();
    ctx.drawImage(logo, x, y - iconSize / 2, iconSize, iconSize);
    ctx.restore();
  }
  ctx.fillStyle = color;
  ctx.fillText(name, x + (hasIcon ? iconSize + gap : 0), y + textSize * 0.04);
}

/** A captioned phone on the light brand wash (one reel scene). */
function renderScene(W, H, screen, caption, p, S, { zoom = 1 } = {}) {
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  backgroundLight(ctx, W, H, p);

  const bodyH = H * 0.7;
  const screenW = (bodyH / (DEVICE_ASPECT + 0.064)) * zoom;
  const cy = H * 0.605;
  const { bodyY: phoneTop } = drawPhone(ctx, screen, W / 2, cy, screenW);

  const titleSize = Math.round(84 * S);
  const subSize = Math.round(45 * S);
  const maxWidth = W * 0.84;
  const bandTop = H * 0.07;
  const bandH = phoneTop - bandTop - 34 * S;
  const probe = measureCaption(ctx, { title: caption.title, subtitle: caption.sub, maxWidth, titleSize, subSize });
  drawCaption(ctx, {
    title: caption.title,
    subtitle: caption.sub,
    centerX: W / 2,
    top: bandTop + Math.max(0, (bandH - probe) / 2),
    maxWidth,
    titleSize,
    subSize,
    titleColor: p.titleColor,
    subColor: p.subColor,
  });
  return c;
}

function renderColdOpen(W, H, logo, brand, p, S) {
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  backgroundDark(ctx, W, H, p);
  drawLockup(ctx, logo, W / 2, H * 0.42, Math.round(200 * S), Math.round(138 * S), brand.name, p.bookendTitle);
  if (brand.tagline) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = font(Math.round(55 * S), 'regular');
    ctx.fillStyle = p.bookendSub;
    ctx.fillText(brand.tagline, W / 2, H * 0.42 + 156 * S);
  }
  return c;
}

function renderEndCard(W, H, logo, brand, p, S) {
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  backgroundDark(ctx, W, H, p);
  drawLockup(ctx, logo, W / 2, H * 0.4, Math.round(180 * S), Math.round(124 * S), brand.name, p.bookendTitle);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  if (brand.endline) {
    ctx.font = font(Math.round(60 * S), 'bold');
    ctx.fillStyle = p.bookendTitle;
    ctx.fillText(brand.endline, W / 2, H * 0.4 + 142 * S);
  }
  if (brand.endsub) {
    ctx.font = font(Math.round(45 * S), 'regular');
    ctx.fillStyle = p.bookendSub;
    ctx.fillText(brand.endsub, W / 2, H * 0.4 + 235 * S);
  }
  return c;
}

/** Build one device-framed reel. Mirrors buildVideo's signature; `spec` carries w/h/fps/profile/level. */
export async function buildReel({ scenes, spec, brand, outFile, timing }) {
  if (!scenes?.length) throw new Error('buildReel: no scenes');
  const { w: W, h: H, fps } = spec;
  const S = W / 1320; // scale the ported (1320-wide) type/stroke constants to any width
  const p = { ...DEFAULT_REEL, ...(brand.reel || {}) };
  const t = { ...DEFAULT_TIMING, ...(timing || {}) };

  const logo = brand.logo && fs.existsSync(brand.logo) ? await loadImage(brand.logo) : null;

  const clips = [{ canvas: renderColdOpen(W, H, logo, brand, p, S), dur: t.coldOpen }];
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    if (!fs.existsSync(s.image)) throw new Error(`Screenshot not found: ${s.image}`);
    const img = await loadImage(s.image);
    clips.push({ canvas: renderScene(W, H, img, { title: s.title, sub: s.sub }, p, S), dur: t.scene });
  }
  clips.push({ canvas: renderEndCard(W, H, logo, brand, p, S), dur: t.endCard });

  const xfade = t.xfade;
  const starts = [0];
  let acc = 0;
  for (let i = 0; i < clips.length - 1; i++) {
    acc += clips[i].dur - xfade;
    starts.push(acc);
  }
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
    const t2 = k / fps;
    fctx.clearRect(0, 0, W, H);
    fctx.fillStyle = p.matteBottom;
    fctx.fillRect(0, 0, W, H);
    for (let i = 0; i < clips.length; i++) {
      const start = starts[i];
      const end = start + clips[i].dur;
      if (t2 < start || t2 >= end) continue;
      const localT = t2 - start;
      const prog = clips[i].dur > 0 ? localT / clips[i].dur : 0;
      const zoomIn = i % 2 === 0;
      const z = zoomIn ? 1.0 + 0.06 * easeInOut(prog) : 1.06 - 0.06 * easeInOut(prog);
      let alpha = 1;
      if (i > 0 && localT < xfade) alpha = smooth(localT / xfade);
      const dw = W * z;
      const dh = H * z;
      fctx.globalAlpha = alpha;
      fctx.drawImage(clips[i].canvas, (W - dw) / 2, (H - dh) / 2, dw, dh);
      fctx.globalAlpha = 1;
    }
    const buf = Buffer.from(fctx.getImageData(0, 0, W, H).data.buffer);
    if (!proc.stdin.write(buf)) {
      await new Promise((r) => proc.stdin.once('drain', r));
    }
  }
  proc.stdin.end();
  await done;
  return { outFile, totalDur, frames: totalFrames, warnings: [] };
}
