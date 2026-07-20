/**
 * Device frames for the `framed` screenshot style — an iPhone bezel (Dynamic Island), an iPad bezel, or a
 * round Apple-Watch ring, with the capture drawn inside. The screen rect follows the capture's OWN aspect,
 * so nothing is cropped. Ported from a production store-asset pipeline; pure rendering.
 *
 * (Mac captures are already windowed — traffic-light title bar — so Mac uses the plain premium still; no
 *  extra window frame is drawn here.)
 */
import { roundRectPath } from './canvas.mjs';

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
export function drawPhoneFrame(ctx, img, cx, cy, screenW) {
  const screenH = screenW * (img.height / img.width);
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
  drawInto(ctx, img, sx, sy, screenW, screenH);
  ctx.restore();

  const iw = Math.round(screenW * 0.3);
  const ih = Math.round(screenW * 0.085);
  roundRectPath(ctx, Math.round(sx + (screenW - iw) / 2), Math.round(sy + bezel * 1.1), iw, ih, ih / 2);
  ctx.fillStyle = '#050505';
  ctx.fill();
  return { bodyH };
}

/** iPad: dark unibody, tight even bezel, gentler corners, no island. */
export function drawIpadFrame(ctx, img, cx, cy, screenW) {
  const screenH = screenW * (img.height / img.width);
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
  drawInto(ctx, img, sx, sy, screenW, screenH);
  ctx.restore();
  return { bodyH };
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
  if (id === 'phone' || id === 'iphone') return drawPhoneFrame;
  if (id === 'ipad') return drawIpadFrame;
  if (id === 'watch') return drawWatchFrame;
  return null; // 'mac' etc. → no added frame
}

/** Infer a frame id from a screenshot target id. */
export function inferFrame(target) {
  if (/iphone|phone/.test(target)) return 'phone';
  if (/ipad|tablet/.test(target)) return 'ipad';
  if (/watch/.test(target)) return 'watch';
  return null;
}
