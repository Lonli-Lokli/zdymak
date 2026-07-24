/** Shared canvas primitives (Skia via @napi-rs/canvas) used by the reel renderer. */

// System fonts (macOS) covering scripts the Brand face lacks — CJK, Arabic, Hebrew, Devanagari,
// Bengali — so LOCALIZED captions render real glyphs instead of tofu (▯▯). Latin/Cyrillic still come
// from Brand (listed first). Missing families are silently skipped, so this is safe on any OS.
// (ja & zh share Han codepoints; the order favours ja kana+kanji, then simplified-zh from PingFang.)
const SCRIPT_FALLBACK =
  '"Hiragino Sans", "PingFang SC", "Apple SD Gothic Neo", "Geeza Pro", "Arial Hebrew", "Kohinoor Devanagari", "Kohinoor Bangla"';

export const font = (sizePx, weight = 'bold') => `${weight} ${sizePx}px Brand, ${SCRIPT_FALLBACK}`;

/** #rrggbb + alpha → rgba() string. */
export function hexA(hex, a) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** #rrggbb → [r,g,b]. */
export function hexRgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Numerically integrated damped spring 0→1 (semi-implicit Euler) → per-frame lookup. Over-damped configs
 *  glide and settle (camera dolly); lighter damping gives a small overshoot. */
export function springSeries(frames, fps, { stiffness = 55, damping = 24, mass = 1.5 } = {}) {
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

/** Rounded-rectangle subpath (no fill/stroke). */
export function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Vertical linear gradient top→bottom filling the whole canvas. */
export function fillVerticalGradient(ctx, w, h, top, bottom) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** Soft radial brand glow — "something is arriving" depth on a dark matte. */
export function radialGlow(ctx, cx, cy, radius, color, alpha) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  g.addColorStop(0, hexA(color, alpha));
  g.addColorStop(1, hexA(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

/** Word-wrap `text` to `maxWidth` at the current font; returns line array. */
export function wrapLines(ctx, text, maxWidth) {
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

/** Typeset a centred caption block (bold title + optional lighter subtitle). Returns height drawn. */
export function drawCaption(ctx, { title, subtitle, centerX, top, maxWidth, titleSize, subSize, titleColor, subColor }) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  let y = top;
  ctx.font = font(titleSize, 'bold');
  ctx.fillStyle = titleColor;
  const titleLH = Math.round(titleSize * 1.12);
  for (const ln of wrapLines(ctx, title, maxWidth)) {
    ctx.fillText(ln, centerX, y);
    y += titleLH;
  }
  if (subtitle) {
    y += Math.round(titleSize * 0.28);
    ctx.font = font(subSize, 'regular');
    ctx.fillStyle = subColor;
    const subLH = Math.round(subSize * 1.3);
    for (const ln of wrapLines(ctx, subtitle, maxWidth)) {
      ctx.fillText(ln, centerX, y);
      y += subLH;
    }
  }
  return y - top;
}

/** Height a caption block WOULD occupy (mirror of drawCaption's layout), for vertical centring. */
export function measureCaption(ctx, { title, subtitle, maxWidth, titleSize, subSize }) {
  ctx.font = font(titleSize, 'bold');
  let h = wrapLines(ctx, title, maxWidth).length * Math.round(titleSize * 1.12);
  if (subtitle) {
    h += Math.round(titleSize * 0.28);
    ctx.font = font(subSize, 'regular');
    h += wrapLines(ctx, subtitle, maxWidth).length * Math.round(subSize * 1.3);
  }
  return h;
}
