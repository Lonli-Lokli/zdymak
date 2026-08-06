/**
 * Device frames for the `framed` screenshot style — an iPhone bezel (Dynamic Island), an iPad bezel, or a
 * round Apple-Watch ring, with the capture drawn inside. The screen rect follows the capture's OWN aspect,
 * so nothing is cropped. Ported from a production store-asset pipeline; pure rendering.
 *
 * (Mac captures are already windowed — traffic-light title bar — so Mac uses the plain premium still; no
 *  extra window frame is drawn here.)
 */
import { roundRectPath } from './canvas.mjs';

/**
 * Paint the screen area. `screen` is either an image (cover-fit, as before) or a callback
 * `(ctx, x, y, w, h) => void` that paints it — the hook that lets the reel scroll content inside a device
 * that itself never moves. With a callback the caller must say how tall the screen is via `opts.aspect`,
 * since there's no image to measure.
 */
function paintScreen(ctx, screen, x, y, w, h) {
  if (typeof screen === 'function') return screen(ctx, x, y, w, h);
  return drawInto(ctx, screen, x, y, w, h);
}

/** Screen height for a frame: the image's own aspect, or an explicit one when painting via callback. */
const screenHeight = (screen, screenW, opts) =>
  screenW * (typeof screen === 'function' ? (opts.aspect ?? 2.165) : screen.height / screen.width);

/** Cover-fit an image into a rect (preserve aspect, crop overflow). */
function drawInto(ctx, img, x, y, w, h) {
  const sAspect = img.height / img.width;
  let dw = w;
  let dh = w * sAspect;
  if (dh < h) {
    dh = h;
    dw = h / sAspect;
  }
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** iPhone: dark unibody, thin uniform bezel, centred Dynamic Island. */
export function drawPhoneFrame(ctx, img, cx, cy, screenW, opts = {}) {
  const screenH = screenHeight(img, screenW, opts);
  const bezel = Math.round(screenW * 0.032);
  const bodyW = screenW + bezel * 2;
  const bodyH = screenH + bezel * 2;
  const bodyX = Math.round(cx - bodyW / 2);
  const bodyY = Math.round(cy - bodyH / 2);
  const sx = bodyX + bezel;
  const sy = bodyY + bezel;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = Math.round(screenW * 0.09);
  ctx.shadowOffsetY = Math.round(screenW * 0.035);
  roundRectPath(ctx, bodyX, bodyY, bodyW, bodyH, Math.round(screenW * 0.155));
  ctx.fillStyle = '#0b0b0a';
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRectPath(ctx, sx, sy, screenW, screenH, Math.round(screenW * 0.135));
  ctx.clip();
  paintScreen(ctx, img, sx, sy, screenW, screenH);
  ctx.restore();

  const iw = Math.round(screenW * 0.3);
  const ih = Math.round(screenW * 0.085);
  roundRectPath(ctx, Math.round(sx + (screenW - iw) / 2), Math.round(sy + bezel * 1.1), iw, ih, ih / 2);
  ctx.fillStyle = '#050505';
  ctx.fill();
  return { bodyH, bodyY, screen: { x: sx, y: sy, w: screenW, h: screenH, r: Math.round(screenW * 0.135) } };
}

/** Android (Pixel-neutral): dark unibody, uniform bezel, centred punch-hole camera. */
export function drawAndroidPhoneFrame(ctx, img, cx, cy, screenW, opts = {}) {
  const screenH = screenHeight(img, screenW, opts);
  const bezel = Math.round(screenW * 0.035);
  const bodyW = screenW + bezel * 2;
  const bodyH = screenH + bezel * 2;
  const bodyX = Math.round(cx - bodyW / 2);
  const bodyY = Math.round(cy - bodyH / 2);
  const sx = bodyX + bezel;
  const sy = bodyY + bezel;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = Math.round(screenW * 0.09);
  ctx.shadowOffsetY = Math.round(screenW * 0.035);
  roundRectPath(ctx, bodyX, bodyY, bodyW, bodyH, Math.round(screenW * 0.13));
  ctx.fillStyle = '#0b0b0a';
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRectPath(ctx, sx, sy, screenW, screenH, Math.round(screenW * 0.105));
  ctx.clip();
  paintScreen(ctx, img, sx, sy, screenW, screenH);
  ctx.restore();

  // Centred punch-hole camera near the top edge.
  ctx.beginPath();
  ctx.arc(sx + screenW / 2, sy + bezel * 1.6, Math.round(screenW * 0.018), 0, Math.PI * 2);
  ctx.fillStyle = '#050505';
  ctx.fill();
  return { bodyH, bodyY, screen: { x: sx, y: sy, w: screenW, h: screenH, r: Math.round(screenW * 0.105) } };
}

/** iPad: dark unibody, tight even bezel, gentler corners, no island. */
export function drawIpadFrame(ctx, img, cx, cy, screenW, opts = {}) {
  const screenH = screenHeight(img, screenW, opts);
  const bezel = Math.round(screenW * 0.024);
  const bodyW = screenW + bezel * 2;
  const bodyH = screenH + bezel * 2;
  const bodyX = Math.round(cx - bodyW / 2);
  const bodyY = Math.round(cy - bodyH / 2);
  const sx = bodyX + bezel;
  const sy = bodyY + bezel;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.36)';
  ctx.shadowBlur = Math.round(screenW * 0.06);
  ctx.shadowOffsetY = Math.round(screenW * 0.024);
  roundRectPath(ctx, bodyX, bodyY, bodyW, bodyH, Math.round(screenW * 0.05));
  ctx.fillStyle = '#0b0b0a';
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRectPath(ctx, sx, sy, screenW, screenH, Math.round(screenW * 0.035));
  ctx.clip();
  paintScreen(ctx, img, sx, sy, screenW, screenH);
  ctx.restore();
  return { bodyH, bodyY, screen: { x: sx, y: sy, w: screenW, h: screenH, r: Math.round(screenW * 0.035) } };
}

/** Apple Watch: round dark unibody, thin ring, a crown nub; the square capture is clipped to the circle. */
export function drawWatchFrame(ctx, img, cx, cy, diameter) {
  const screenR = diameter / 2;
  const bezel = Math.round(diameter * 0.05);
  const bodyR = screenR + bezel;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = Math.round(diameter * 0.08);
  ctx.shadowOffsetY = Math.round(diameter * 0.03);
  ctx.beginPath();
  ctx.arc(cx, cy, bodyR, 0, Math.PI * 2);
  ctx.fillStyle = '#0b0b0a';
  ctx.fill();
  ctx.restore();

  // Crown nub on the right edge.
  const crownW = Math.round(diameter * 0.03);
  const crownH = Math.round(diameter * 0.12);
  roundRectPath(ctx, cx + bodyR - Math.round(crownW * 0.35), cy - crownH / 2, crownW, crownH, Math.round(crownW * 0.5));
  ctx.fillStyle = '#1a1a18';
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, screenR, 0, Math.PI * 2);
  ctx.clip();
  drawInto(ctx, img, cx - screenR, cy - screenR, diameter, diameter);
  ctx.restore();
  return { bodyH: bodyR * 2 };
}

/**
 * Laptop / Chromebook: a clamshell — landscape lid with a thin bezel, on a keyboard deck that tapers
 * away from the viewer. The screen rect follows the capture's own aspect, like every other frame here.
 *
 * `cy` is the centre of the LID (not of lid + deck), so a laptop lines up with the phones and tablets
 * beside it in a cluster instead of floating high by half a deck.
 */
export function drawLaptopFrame(ctx, img, cx, cy, screenW, opts = {}) {
  const screenH = screenHeight(img, screenW, opts);
  const bezel = Math.round(screenW * 0.022);
  const lidW = screenW + bezel * 2;
  const lidH = screenH + bezel * 2 + Math.round(screenW * 0.018); // extra chin below the screen
  const lidX = Math.round(cx - lidW / 2);
  const lidY = Math.round(cy - lidH / 2);
  const sx = lidX + bezel;
  const sy = lidY + bezel;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.38)';
  ctx.shadowBlur = Math.round(screenW * 0.05);
  ctx.shadowOffsetY = Math.round(screenW * 0.02);
  roundRectPath(ctx, lidX, lidY, lidW, lidH, Math.round(screenW * 0.016));
  ctx.fillStyle = '#0b0b0a';
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRectPath(ctx, sx, sy, screenW, screenH, Math.round(screenW * 0.008));
  ctx.clip();
  paintScreen(ctx, img, sx, sy, screenW, screenH);
  ctx.restore();

  // Keyboard deck — a shallow trapezoid under the lid, wider than it, with a hinge lip and a trackpad
  // notch. Drawn as a path rather than a rect so the machine reads as sitting on a surface.
  const deckH = Math.round(screenW * 0.028);
  const deckTop = lidY + lidH;
  const overhang = Math.round(screenW * 0.045);
  ctx.beginPath();
  ctx.moveTo(lidX - overhang * 0.25, deckTop);
  ctx.lineTo(lidX + lidW + overhang * 0.25, deckTop);
  ctx.lineTo(lidX + lidW + overhang, deckTop + deckH);
  ctx.lineTo(lidX - overhang, deckTop + deckH);
  ctx.closePath();
  ctx.fillStyle = '#141412';
  ctx.fill();
  // Hinge lip catching the light along the top edge of the deck.
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(lidX - overhang * 0.25, deckTop, lidW + overhang * 0.5, Math.max(1, Math.round(deckH * 0.16)));

  return { bodyH: lidH + deckH, bodyY: lidY, screen: { x: sx, y: sy, w: screenW, h: screenH, r: Math.round(screenW * 0.008) } };
}

/**
 * Fraction of a raw macOS window capture taken up by its OWN title bar. `screencapture -l <window>`
 * includes the real title bar, so a frame that draws its own must crop this off or the shot shows two
 * stacked title bars.
 */
const RAW_TITLEBAR_FRAC = 0.065;

/**
 * A macOS WINDOW: slim title bar with traffic lights, rounded body, soft shadow, hairline rim. Used on
 * its own (`mac-window`) and as the screen of the MacBook below.
 *
 * Draws its own title bar rather than keeping the capture's, so every Mac shot has the same chrome at the
 * same weight regardless of what the window looked like when it was captured.
 */
export function drawMacWindowFrame(ctx, img, cx, cy, winW) {
  const srcTop = Math.round(img.height * RAW_TITLEBAR_FRAC);
  const srcH = img.height - srcTop;
  const titleH = Math.round(winW * 0.038);
  const bodyH = Math.round(winW * (srcH / img.width));
  const winH = titleH + bodyH;
  const x = Math.round(cx - winW / 2);
  const y = Math.round(cy - winH / 2);
  const r = Math.round(winW * 0.014);

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.34)';
  ctx.shadowBlur = Math.round(winW * 0.028);
  ctx.shadowOffsetY = Math.round(winW * 0.012);
  roundRectPath(ctx, x, y, winW, winH, r);
  ctx.fillStyle = '#1c1c1e';
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRectPath(ctx, x, y, winW, winH, r);
  ctx.clip();
  ctx.fillStyle = '#e9e9ea';
  ctx.fillRect(x, y, winW, titleH);
  const dotR = Math.round(titleH * 0.16);
  const dotY = Math.round(y + titleH / 2);
  const dotGap = Math.round(dotR * 3.1);
  const dotX0 = Math.round(x + titleH * 0.62);
  ['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => {
    ctx.beginPath();
    ctx.arc(dotX0 + i * dotGap, dotY, dotR, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
  });
  ctx.drawImage(img, 0, srcTop, img.width, srcH, x, y + titleH, winW, bodyH);
  ctx.restore();

  ctx.save();
  roundRectPath(ctx, x + 0.5, y + 0.5, winW - 1, winH - 1, r);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.16)';
  ctx.stroke();
  ctx.restore();
  return { bodyH: winH, bodyY: y, screen: { x, y: y + titleH, w: winW, h: bodyH, r } };
}

/**
 * A MacBook: the macOS window above, seated in an aluminium clamshell — thin dark lid, tapered silver
 * deck with a hinge lip and a notch for the lip cut-out.
 *
 * Distinct from `laptop`/`chromebook` on purpose. Those draw a dark deck for a generic/Chromebook body;
 * this one is lighter and thinner, and carries real window chrome, so an Apple listing reads as Apple
 * hardware instead of an anonymous laptop.
 */
export function drawMacBookFrame(ctx, img, cx, cy, screenW) {
  const bezel = Math.round(screenW * 0.013);
  // Measure the window first so the lid can be sized around it.
  const srcTop = Math.round(img.height * RAW_TITLEBAR_FRAC);
  const titleH = Math.round(screenW * 0.038);
  const winH = titleH + Math.round(screenW * ((img.height - srcTop) / img.width));

  const lidW = screenW + bezel * 2;
  const lidH = winH + bezel * 2;
  const lidX = Math.round(cx - lidW / 2);
  const lidY = Math.round(cy - lidH / 2);

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.30)';
  ctx.shadowBlur = Math.round(screenW * 0.04);
  ctx.shadowOffsetY = Math.round(screenW * 0.014);
  roundRectPath(ctx, lidX, lidY, lidW, lidH, Math.round(screenW * 0.013));
  ctx.fillStyle = '#2c2c2e'; // space grey lid
  ctx.fill();
  ctx.restore();

  drawMacWindowFrame(ctx, img, cx, lidY + bezel + winH / 2, screenW);

  // Aluminium deck: a shallow trapezoid wider than the lid, with a hinge lip and a lip cut-out notch.
  const deckH = Math.round(screenW * 0.022);
  const deckTop = lidY + lidH;
  const over = Math.round(screenW * 0.035);
  ctx.beginPath();
  ctx.moveTo(lidX - over * 0.2, deckTop);
  ctx.lineTo(lidX + lidW + over * 0.2, deckTop);
  ctx.lineTo(lidX + lidW + over, deckTop + deckH);
  ctx.lineTo(lidX - over, deckTop + deckH);
  ctx.closePath();
  ctx.fillStyle = '#d8d8d6';
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(lidX - over * 0.2, deckTop, lidW + over * 0.4, Math.max(1, Math.round(deckH * 0.18)));
  // Lip cut-out.
  const notchW = Math.round(lidW * 0.14);
  roundRectPath(ctx, Math.round(cx - notchW / 2), deckTop + deckH - Math.round(deckH * 0.34), notchW, Math.round(deckH * 0.34), Math.round(deckH * 0.17));
  ctx.fillStyle = 'rgba(0,0,0,0.10)';
  ctx.fill();

  return { bodyH: lidH + deckH, bodyY: lidY };
}

/** Dispatch by frame id → the draw fn (null for unsupported → caller falls back to a plain still). */
export function frameFor(id) {
  return {
    phone: drawPhoneFrame, iphone: drawPhoneFrame,
    android: drawAndroidPhoneFrame,
    ipad: drawIpadFrame, tablet: drawIpadFrame,
    watch: drawWatchFrame,
    laptop: drawLaptopFrame, chromebook: drawLaptopFrame, desktop: drawLaptopFrame,
    macbook: drawMacBookFrame,
    'mac-window': drawMacWindowFrame,
  }[id] || null; // 'mac' → no added frame; the capture keeps its own chrome (back-compatible default)
}

/** Infer a frame id from a screenshot target id (order matters: play-phone → android before → phone). */
export function inferFrame(target) {
  if (/watch|wear/.test(target)) return 'watch';
  // Play targets are matched FIRST: `play-tablet` contains "tablet", so an ipad/tablet test placed above
  // this would frame Android tablet captures in an iPad body — the same misrepresentation we refuse to
  // make on phones.
  if (/^play/.test(target) || /android/.test(target)) return 'android';
  if (/ipad|tablet/.test(target)) return 'ipad';
  if (/iphone|phone/.test(target)) return 'phone';
  return null;
}
