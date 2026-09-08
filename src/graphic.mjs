/**
 * Feature graphic — Google Play's 1024×500 listing banner (no alpha). A brand matte with the logo +
 * wordmark + tagline on the left and a tilted device (a hero capture in a frame) bleeding off the right.
 * Ported/generalized from a production store-asset pipeline; brand-driven.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { font, hexA, roundRectPath, fillVerticalGradient, radialGlow } from './canvas.mjs';
import { frameFor, drawAndroidPhoneFrame } from './frames.mjs';
import { rgbPngBuffer } from './png.mjs';

const DEFAULT = { matteTop: '#052E16', matteBottom: '#0b0b0a', glow: null, glowAlpha: 0.22 };

/**
 * The banner's ground, taking the game's own palette when it has one.
 *
 * `matteTop`/`matteBottom` name the graphic's gradient, `bgTop`/`bgBottom` name the screenshots'.
 * Two names for the same intent, and only the first reached this file — so a game that themed its
 * screenshots got the built-in GREEN here and never knew, because nothing errors and the banner
 * looks perfectly good on its own. It only shows up side by side: two titles from one studio, one
 * of them wearing the other's colour, on the same Play developer page.
 *
 * So the screenshot ground is the fallback. A game that wants the banner to differ still says
 * matteTop/matteBottom and wins; a game that themed itself once now gets one brand everywhere.
 */
function ground(theme) {
  const t = theme || {};
  return {
    ...DEFAULT,
    ...t,
    matteTop: t.matteTop ?? t.bgTop ?? DEFAULT.matteTop,
    matteBottom: t.matteBottom ?? t.bgBottom ?? DEFAULT.matteBottom,
  };
}

/** Split a tagline into ≤2 lines (on the first sentence break, else the whole thing). */
function splitTagline(t) {
  if (!t) return ['', ''];
  const m = t.match(/^(.*?[.!?])\s+(.*)$/);
  return m ? [m[1], m[2]] : [t, ''];
}

/** Build the 1024×500 feature graphic → writes a no-alpha PNG. `frame`: which device frame for the hero. */
export async function buildFeatureGraphic({ W = 1024, H = 500, brand, theme, heroPath, outFile, frame = 'android' }) {
  const th = ground(theme);
  const glow = th.glow || brand.sub;
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  fillVerticalGradient(ctx, W, H, th.matteTop, th.matteBottom);
  radialGlow(ctx, W * 0.3, H * 0.5, W * 0.5, glow, th.glowAlpha);

  const leftX = 72;
  const iconSize = 92;
  // Shifts the whole left-hand block — lockup, tagline, endline — down together. The default
  // layout hangs it from the top, which leaves a game with a short tagline sitting in the upper
  // corner with the bottom third of the graphic empty. One offset rather than four so the block
  // keeps its own internal spacing.
  const textY = Number.isFinite(brand.textOffsetY) ? brand.textOffsetY : 0;
  const logo = brand.logo && fs.existsSync(brand.logo) ? await loadImage(brand.logo) : null;
  if (logo) {
    ctx.save();
    roundRectPath(ctx, leftX, 70 + textY, iconSize, iconSize, iconSize * 0.22);
    ctx.clip();
    ctx.drawImage(logo, leftX, 70 + textY, iconSize, iconSize);
    ctx.restore();
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = font(76, 'bold');
  ctx.fillStyle = brand.title;
  const lockupGap = Number.isFinite(brand.lockupGap) ? iconSize * brand.lockupGap : 26;
  ctx.fillText(brand.name || 'App', leftX + (logo ? iconSize + lockupGap : 0), 70 + textY + iconSize / 2 + 4);

  ctx.textBaseline = 'top';
  const [t1, t2] = splitTagline(brand.tagline);
  ctx.font = font(48, 'bold');
  ctx.fillStyle = brand.title;
  if (t1) ctx.fillText(t1, leftX, 220 + textY);
  if (t2) {
    ctx.fillStyle = brand.sub;
    ctx.fillText(t2, leftX, 278 + textY);
  }
  if (brand.endsub) {
    ctx.font = font(28, 'regular');
    ctx.fillStyle = hexA(brand.sub, 0.85);
    ctx.fillText(brand.endsub, leftX, 352 + textY);
  }

  const fan = (brand.fan || []).filter((f) => fs.existsSync(f));
  if (fan.length) {
    const spread = brand.fanSpread ?? 0.17;
    const cx = brand.fanX ?? W * 0.55;
    const cy = brand.fanY ?? H * 0.92;
    const h = brand.fanHeight ?? 300;
    const mid = (fan.length - 1) / 2;
    for (let i = 0; i < fan.length; i++) {
      const img = await loadImage(fan[i]);
      const w = (img.width / img.height) * h;
      ctx.save();
      ctx.translate(cx + (i - mid) * (w * 0.52), cy);
      ctx.rotate((i - mid) * spread);
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 6;
      ctx.drawImage(img, -w / 2, -h, w, h);
      ctx.restore();
    }
  }

  if (heroPath && fs.existsSync(heroPath)) {
    const hero = await loadImage(heroPath);
    const pc = createCanvas(640, 960);
    const pctx = pc.getContext('2d');
    (frameFor(frame) || drawAndroidPhoneFrame)(pctx, hero, pc.width / 2, pc.height / 2, 250);
    ctx.save();
    ctx.translate(W - 150, H / 2 + 40);
    ctx.rotate(-0.12);
    ctx.drawImage(pc, -pc.width / 2, -pc.height / 2);
    ctx.restore();
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, rgbPngBuffer(c));
  return { outFile, W, H };
}


/**
 * A branded square built from `brand.logo` — the Play app icon, and Apple's in-app purchase image.
 *
 * One drawing, two destinations that disagree about exactly one thing. **Play's icon keeps its
 * alpha** — it is the one store asset where transparency is legal, because Play masks the icon to
 * its own shape and a squared-off corner would be baked in otherwise. **Apple's in-app purchase
 * promotional image must be flattened** ("72 dpi, RGB, flattened and no rounded corners"), so it
 * is painted onto the brand ground first and written through the RGB encoder.
 *
 * [flatten] is passed from the destination's own `alpha` rather than guessed here, so the rule
 * lives in the spec table with every other thing a store insists on.
 *
 * This is a branded graphic, not a per-scene screenshot, which is why both targets carry
 * `graphic: true`. If no logo is configured we refuse rather than emit a blank square — a
 * silently-empty icon is worse than a clear error at build time.
 */
export async function buildAppIcon({ W = 512, H = 512, brand, theme, outFile, flatten = false }) {
  const th = ground(theme);
  if (!brand.logo || !fs.existsSync(brand.logo)) {
    throw new Error(
      "this target needs `brand.logo` — a square PNG of your app icon. Set it, or drop the target " +
      '(both stores also accept the image uploaded straight to the console, so this is a convenience).',
    );
  }
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  // Only where alpha is forbidden: a logo with transparency would otherwise be composited against
  // nothing and arrive black, which is a worse failure than the one being prevented.
  if (flatten) {
    ctx.fillStyle = th.ink;
    ctx.fillRect(0, 0, W, H);
  }
  const logo = await loadImage(brand.logo);
  // Fill the square: Play shows the icon masked to its own shape, so bleed to the edges and let the
  // store apply the mask. Any transparency in the source logo is preserved where alpha is legal.
  const a = logo.height / logo.width;
  let dw = W;
  let dh = W * a;
  if (dh < H) { dh = H; dw = H / a; }
  ctx.drawImage(logo, (W - dw) / 2, (H - dh) / 2, dw, dh);
  // `rgbPngBuffer` drops the alpha channel; the icon must NOT go through it.
  fs.writeFileSync(outFile, flatten ? rgbPngBuffer(c) : c.toBuffer('image/png'));
  return { outFile, W, H };
}
