/**
 * Still-image renderers — one store screenshot per scene, in a chosen style. Aspect-agnostic (cover-fit),
 * so the same renderers serve iPhone, iPad, Mac and Watch dimensions.
 *
 *   premium — the app screen floats on a brand matte (glow + vignette) with a bottom title pill.
 *   bleed   — the app screen fills the frame, with an optional lower-third caption. Best for Watch (raw).
 *
 * (Device-FRAMED stills — iPhone/iPad bezel, Mac window, Watch ring — are the next addition; `framed`
 *  currently falls back to `bleed`.)
 */
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { premiumStill } from './premium.mjs';
import { drawCaption, hexA } from './canvas.mjs';

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

function bleedStill({ W, H, img, caption, brand }) {
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = brand.ink;
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(coverCanvas(img, W, H), 0, 0);
  if (caption.title || caption.sub) {
    const g = ctx.createLinearGradient(0, H * 0.55, 0, H);
    g.addColorStop(0, hexA(brand.ink, 0));
    g.addColorStop(1, hexA(brand.ink, 0.85));
    ctx.fillStyle = g;
    ctx.fillRect(0, H * 0.55, W, H * 0.45);
    drawCaption(ctx, {
      title: caption.title,
      subtitle: caption.sub,
      centerX: W / 2,
      top: H * 0.78,
      maxWidth: W * 0.86,
      titleSize: Math.round(W * 0.066),
      subSize: Math.round(W * 0.036),
      titleColor: brand.title,
      subColor: brand.sub,
    });
  }
  return c;
}

/** Render one still to a canvas. `style`: premium | bleed | framed(→bleed for now). */
export async function renderStill(style, { W, H, imgPath, caption, brand, theme }) {
  const img = await loadImage(imgPath);
  if (style === 'premium') return premiumStill({ W, H, img, caption, brand, theme });
  return bleedStill({ W, H, img, caption, brand });
}
