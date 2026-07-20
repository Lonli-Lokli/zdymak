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

/** Split a tagline into ≤2 lines (on the first sentence break, else the whole thing). */
function splitTagline(t) {
  if (!t) return ['', ''];
  const m = t.match(/^(.*?[.!?])\s+(.*)$/);
  return m ? [m[1], m[2]] : [t, ''];
}

/** Build the 1024×500 feature graphic → writes a no-alpha PNG. `frame`: which device frame for the hero. */
export async function buildFeatureGraphic({ W = 1024, H = 500, brand, theme, heroPath, outFile, frame = 'android' }) {
  const th = { ...DEFAULT, ...(theme || {}) };
  const glow = th.glow || brand.sub;
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  fillVerticalGradient(ctx, W, H, th.matteTop, th.matteBottom);
  radialGlow(ctx, W * 0.3, H * 0.5, W * 0.5, glow, th.glowAlpha);

  const leftX = 72;
  const iconSize = 92;
  const logo = brand.logo && fs.existsSync(brand.logo) ? await loadImage(brand.logo) : null;
  if (logo) {
    ctx.save();
    roundRectPath(ctx, leftX, 70, iconSize, iconSize, iconSize * 0.22);
    ctx.clip();
    ctx.drawImage(logo, leftX, 70, iconSize, iconSize);
    ctx.restore();
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = font(76, 'bold');
  ctx.fillStyle = brand.title;
  ctx.fillText(brand.name || 'App', leftX + (logo ? iconSize + 26 : 0), 70 + iconSize / 2 + 4);

  ctx.textBaseline = 'top';
  const [t1, t2] = splitTagline(brand.tagline);
  ctx.font = font(48, 'bold');
  ctx.fillStyle = brand.title;
  if (t1) ctx.fillText(t1, leftX, 220);
  if (t2) {
    ctx.fillStyle = brand.sub;
    ctx.fillText(t2, leftX, 278);
  }
  if (brand.endsub) {
    ctx.font = font(28, 'regular');
    ctx.fillStyle = hexA(brand.sub, 0.85);
    ctx.fillText(brand.endsub, leftX, 352);
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
