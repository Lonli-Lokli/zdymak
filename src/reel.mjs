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
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { loadCapture } from './statusbar.mjs';
import { font, hexA, roundRectPath, fillVerticalGradient, radialGlow, drawCaption, measureCaption } from './canvas.mjs';
import { frameFor } from './frames.mjs';
import { spawnEncoder } from './encode.mjs';
import { springSeries } from './easings.mjs';
import { transitionFor } from './transitions.mjs';
import { effectFor } from './effects.mjs';

/**
 * Cuts come from the transition REGISTRY (`transitions.mjs`) — each scene names how we get INTO it via
 * `cut`, defaulting to a hard cut. Adding a new one is an entry in that table, not a change here.
 */

const DEVICE_ASPECT = 2.165; // iPhone screen height/width (~19.5:9); screenshots are cover-fit into it.

/** Default reel palette — a calm green/stone brand. Override any key via `brand.reel` in the config. */
const DEFAULT_REEL = {
  bgTop: '#FAFAF9', bgBottom: '#DCFCE7', glowLight: '#BBF7D0', // soft light wash for the screen scenes
  matteTop: '#052E16', matteBottom: '#0b0b0a', glowDark: '#16A34A', // dark matte for cold-open / end-card
  titleColor: '#1C1917', subColor: '#78716C', // captions on the light wash
  bookendTitle: '#FAFAF9', bookendSub: '#BBF7D0', // text on the dark matte
};

const DEFAULT_TIMING = { coldOpen: 1.4, scene: 2.6, endCard: 2.4, xfade: 0.45 };

/** Scene hold: beat-matched when `bpm` is given (cuts land on the music), else the fixed `scene` value. */
const sceneHold = (t) => (t.bpm ? ((t.beatsPerCut || 4) * 60) / t.bpm : t.scene);

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const smooth = (t) => t * t * (3 - 2 * t);

function backgroundLight(ctx, W, H, p) {
  fillVerticalGradient(ctx, W, H, p.bgTop, p.bgBottom);
  // Two glows, not one: a bright key behind the device's shoulders and a wider, weaker fill low and
  // off-centre. A single centred wash is what makes a matte look like blank paper.
  radialGlow(ctx, W * 0.5, H * 0.30, W * 0.78, p.glowLight, 0.62);
  radialGlow(ctx, W * 0.22, H * 0.86, W * 0.9, p.glowLight, 0.3);
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
  ctx.shadowColor = 'rgba(16,40,26,0.30)';
  ctx.shadowBlur = Math.round(screenW * 0.16);
  ctx.shadowOffsetY = Math.round(screenW * 0.06);
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
  if (typeof screen === 'function') {
    screen(ctx, screenX, screenY, screenW, screenH);
  } else {
    const sAspect = screen.height / screen.width;
    let dw = screenW;
    let dh = screenW * sAspect;
    if (dh < screenH) {
      dh = screenH;
      dw = screenH / sAspect;
    }
    ctx.drawImage(screen, screenX + (screenW - dw) / 2, screenY + (screenH - dh) / 2, dw, dh);
  }
  ctx.restore();

  // Dynamic Island pill.
  const islandW = Math.round(screenW * 0.3);
  const islandH = Math.round(screenW * 0.085);
  roundRectPath(ctx, Math.round(screenX + (screenW - islandW) / 2), Math.round(screenY + bezel * 1.1), islandW, islandH, islandH / 2);
  ctx.fillStyle = '#050505';
  ctx.fill();

  return { bodyY, bodyH, screen: { x: screenX, y: screenY, w: screenW, h: screenH, r: screenR } };
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

/**
 * Build one scene as SEPARATE LAYERS so the composite can move content without moving the device.
 *
 * The old engine pre-rendered the whole scene to one canvas and then scaled that canvas 6% in/out per
 * beat — which zoomed the phone body and the headline along with the app, the tell of a cheap
 * slideshow. Real product videos pin the chrome and the type, and move only what's on screen.
 *
 * Returns `{ plate, chrome, content, geo, travel }`:
 *   plate   — background wash + caption (never moves)
 *   chrome  — the device body, drawn over the content so the bezel/island/punch-hole stay on top
 *   content — the capture at screen width; taller than the viewport when there's below-the-fold UI
 *   travel  — how many px of real content sit below the fold (0 = nothing to scroll)
 */
function buildScene(W, H, screen, caption, p, S, { frame, effect, scroll } = {}) {
  const fx = effectFor(effect);
  // 0.72 of the frame, centred at 0.60: enough presence that the product is the subject, while leaving
  // ~17% of height for the caption band above and a clean margin below.
  const bodyH = H * 0.72;
  const screenW = bodyH / (DEVICE_ASPECT + 0.064);
  const cy = H * 0.6;

  const draw = frame && frame !== 'iphone' && frame !== 'phone' ? frameFor(frame) : drawPhone;
  if (!draw) throw new Error(`reel: unknown frame "${frame}" (try iphone | android | ipad | watch).`);

  // Measure once with an empty screen: we need the screen rect (to size the content) and the body top
  // (to place the caption above it). Cheap, and keeps the per-frame path free of layout work.
  const probeCanvas = createCanvas(W, H);
  const geo = draw(probeCanvas.getContext('2d'), () => {}, W / 2, cy, screenW, { aspect: DEVICE_ASPECT });
  const sr = geo.screen;
  const phoneTop = geo.bodyY ?? cy - geo.bodyH / 2;

  // The capture at screen width. Taller than the viewport wherever the screen has below-the-fold UI —
  // that overflow is what scrolls.
  const contentH = Math.round(sr.w * (screen.height / screen.width));
  const content = createCanvas(sr.w, Math.max(contentH, Math.round(sr.h)));
  const contentCtx = content.getContext('2d');
  if (fx.filter) contentCtx.filter = fx.filter; // colour grade lives on the capture, not the matte
  contentCtx.drawImage(screen, 0, 0, sr.w, contentH);

  const plate = createCanvas(W, H);
  const pctx = plate.getContext('2d');
  backgroundLight(pctx, W, H, p);
  const titleSize = Math.round(84 * S);
  const subSize = Math.round(45 * S);
  const maxWidth = W * 0.84;
  const bandTop = H * 0.07;
  const bandH = phoneTop - bandTop - 34 * S;
  const probe = measureCaption(pctx, { title: caption.title, subtitle: caption.sub, maxWidth, titleSize, subSize });
  drawCaption(pctx, {
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

  return { plate, content, draw, screenW, cy, fx, scroll, brand: p, travel: Math.max(0, contentH - Math.round(sr.h)) };
}

/**
 * Composite one scene at progress `prog` (0→1). The device body and the caption are pinned; only the
 * capture moves, scrolling inside the viewport where there's real content below the fold.
 *
 * The device is drawn per frame with the content supplied as a CALLBACK, so the frame keeps its natural
 * paint order — body, then clipped screen, then island/punch-hole on top — with no layer surgery.
 */
function paintScene(ctx, scene, prog, t = 0) {
  const { plate, content, draw, screenW, cy, travel, fx, scroll, brand } = scene;
  ctx.drawImage(plate, 0, 0);
  draw(ctx, (c, x, y, w, h) => {
    // STATIC unless the scene opts in with `scroll: true`. Scrolling every screen parks each one at an
    // arbitrary mid-scroll position — header gone, next content not yet arrived — so a full screen ends
    // up reading as a half-empty one. Motion belongs between scenes, not inside them.
    const reach = scroll ? Math.min(travel, h * 0.33) : 0;
    c.drawImage(content, x, y - (reach ? easeInOut(prog) * reach : 0));
  }, ctx.canvas.width / 2, cy, screenW, { aspect: DEVICE_ASPECT });
  // Overlays (grain, vignette, particles, light) sit over the whole finished frame, film-style.
  fx?.overlay?.(ctx, { W: ctx.canvas.width, H: ctx.canvas.height, t, p: prog, brand });
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
// `theme` is accepted only for the status-bar knobs (`statusBar` / `statusBarTime`) — the reel's own
// palette comes from `brand.reel`, not from here.
export async function buildReel({ scenes, spec, brand, outFile, timing, music, theme }) {
  if (!scenes?.length) throw new Error('buildReel: no scenes');
  const { w: W, h: H, fps } = spec;
  const S = W / 1320; // scale the ported (1320-wide) type/stroke constants to any width
  const p = { ...DEFAULT_REEL, ...(brand.reel || {}) };
  const t = { ...DEFAULT_TIMING, ...(timing || {}) };

  const logo = brand.logo && fs.existsSync(brand.logo) ? await loadImage(brand.logo) : null;

  // A clip is either a static bookend canvas or a layered scene painted per frame.
  const clips = [{ still: renderColdOpen(W, H, logo, brand, p, S), dur: t.coldOpen }];
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    if (!fs.existsSync(s.image)) throw new Error(`Screenshot not found: ${s.image}`);
    const img = await loadCapture(s.image, theme, theme?.frame);
    clips.push({
      scene: buildScene(W, H, img, { title: s.title, sub: s.sub }, p, S, { frame: theme?.frame, effect: s.effect || theme?.effect, scroll: !!s.scroll }),
      dur: sceneHold(t),
      // How we get INTO this clip. Bookend-adjacent boundaries always dissolve — a logo card that
      // hard-cuts or slides reads as a slideshow.
      cut: i === 0 ? 'dissolve' : s.cut || 'cut',
      push: !!s.push, // the one earned camera move
    });
  }
  clips.push({ still: renderEndCard(W, H, logo, brand, p, S), dur: t.endCard, cut: 'dissolve' });

  // Each boundary's overlap is its own cut's length, so a hard cut costs a frame and a dissolve costs
  // its full duration — the old engine charged every boundary the same 0.45s.
  const cutDur = (i) => Math.min(transitionFor(clips[i]?.cut, i).dur, clips[i - 1]?.dur ?? Infinity);
  const starts = [0];
  let acc = 0;
  for (let i = 0; i < clips.length - 1; i++) {
    acc += clips[i].dur - cutDur(i + 1);
    starts.push(acc);
  }
  const totalDur = starts[starts.length - 1] + clips[clips.length - 1].dur;
  const totalFrames = Math.round(totalDur * fps);

  const frame = createCanvas(W, H);
  const fctx = frame.getContext('2d');

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const { proc, done } = spawnEncoder({ W, H, fps, spec, outFile, music, totalDur });

  // Scratch layers: each clip is painted whole, then transformed as a unit.
  const layerA = createCanvas(W, H);
  const laCtx = layerA.getContext('2d');
  const layerB = createCanvas(W, H);
  const lbCtx = layerB.getContext('2d');

  // The one earned camera move: an overdamped spring push-in, precomputed once and reused by any scene
  // flagged `push`. Overdamped so it settles without a bounce.
  const PUSH = springSeries(Math.ceil(sceneHold(t) * fps) + 2, fps);
  const pushAt = (localT) => PUSH[Math.min(PUSH.length - 1, Math.max(0, Math.round(localT * fps)))];

  const paintClip = (ctx, clip, prog, localT) => {
    ctx.clearRect(0, 0, W, H);
    if (clip.still) return void ctx.drawImage(clip.still, 0, 0);
    if (!clip.push) return paintScene(ctx, clip.scene, prog, localT);
    // Scale about the device centre so the caption stays pinned while the product comes forward.
    const z = 1 + 0.05 * pushAt(localT);
    const cx = W / 2;
    const cy = clip.scene.cy;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(z, z);
    ctx.translate(-cx, -cy);
    paintScene(ctx, clip.scene, prog, localT);
    ctx.restore();
  };

  // The base the frame is cleared to. It must be the SCENE wash, not the dark bookend matte: a card
  // turning edge-on (flip / spin) exposes whatever is behind it, and against `matteBottom` that showed
  // as a black flash in the middle of a light reel. Painted once, blitted per frame.
  const wash = createCanvas(W, H);
  backgroundLight(wash.getContext('2d'), W, H, p);

  for (let k = 0; k < totalFrames; k++) {
    const t2 = k / fps;
    fctx.clearRect(0, 0, W, H);
    fctx.drawImage(wash, 0, 0);

    let idx = 0;
    for (let i = 0; i < clips.length; i++) if (t2 >= starts[i]) idx = i;
    const localT = t2 - starts[idx];
    const prog = clips[idx].dur > 0 ? Math.min(1, localT / clips[idx].dur) : 0;
    const dur = cutDur(idx);
    const inCut = idx > 0 && localT < dur;

    paintClip(lbCtx, clips[idx], prog, localT);

    if (!inCut) {
      fctx.drawImage(layerB, 0, 0);
    } else {
      const raw = dur > 0 ? localT / dur : 1;
      const prev = clips[idx - 1];
      const prevLocal = t2 - starts[idx - 1];
      paintClip(laCtx, prev, prev.dur > 0 ? Math.min(1, prevLocal / prev.dur) : 1, prevLocal);
      transitionFor(clips[idx].cut, idx).paint(fctx, layerA, layerB, raw, { W, H });
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
