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

/** Dispatch by frame id → the draw fn (null for unsupported → caller falls back to a plain still). */
export function frameFor(id) {
  return {
    phone: drawPhoneFrame, iphone: drawPhoneFrame,
    android: drawAndroidPhoneFrame,
    ipad: drawIpadFrame, tablet: drawIpadFrame,
    watch: drawWatchFrame,
  }[id] || null; // 'mac' etc. → no added frame
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
