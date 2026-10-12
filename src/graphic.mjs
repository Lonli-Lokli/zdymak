/**
 * Branded graphics — one image per target, built from the brand and one hero capture, never per scene.
 *
 *   Feature graphic — Google Play's 1024×500 listing banner (no alpha), and the social card. A brand matte
 *   with the logo + wordmark + tagline on the left and a tilted device (a hero capture in a frame)
 *   bleeding off the right. Ported/generalized from a production store-asset pipeline; brand-driven.
 *
 *   Creative assets — the App Store's iOS 27 product page header, search results image and universal
 *   asset. The same parts, laid out around Apple's art safe area because the store crops them
 *   (see `buildCreativeGraphic`).
 *
 *   App icon — a branded square from `brand.logo` (the Play icon, Apple's in-app purchase image).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { font, hexA, roundRectPath, fillVerticalGradient, radialGlow, wrapLines } from './canvas.mjs';
import { frameFor, drawAndroidPhoneFrame, screenAspectFor } from './frames.mjs';
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

/**
 * `brand.fan` — images fanned out like a hand of cards, each rotated a little further from the middle,
 * overlapped and drop-shadowed, standing on (cx, cy): `cy` is where the cards' bottom edges meet.
 * Missing files are skipped. Shared by the feature graphic and the App Store creative assets.
 */
async function drawFan(ctx, paths, { cx, cy, h, spread, blur, offsetY, step = 0.52, arc = 0 }) {
  const fan = (paths || []).filter((f) => fs.existsSync(f));
  const mid = (fan.length - 1) / 2;
  for (let i = 0; i < fan.length; i++) {
    const img = await loadImage(fan[i]);
    const w = (img.width / img.height) * h;
    ctx.save();
    // `step` is how far apart neighbouring cards stand, in card widths; `arc` drops each card a share of
    // its height per place from the middle, so a wide hand curves the way a held one does.
    ctx.translate(cx + (i - mid) * (w * step), cy + Math.abs(i - mid) * h * arc);
    ctx.rotate((i - mid) * spread);
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = blur;
    ctx.shadowOffsetY = offsetY;
    ctx.drawImage(img, -w / 2, -h, w, h);
    ctx.restore();
  }
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

  await drawFan(ctx, brand.fan, {
    cx: brand.fanX ?? W * 0.55,
    cy: brand.fanY ?? H * 0.92,
    h: brand.fanHeight ?? 300,
    spread: brand.fanSpread ?? 0.17,
    blur: 18,
    offsetY: 6,
  });

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
 * App Store CREATIVE ASSETS (iOS 27 / iPadOS 27): the product page header (21:9), the search results
 * image (3:2) and the universal 16:9 asset that can serve as both.
 *
 * The same brand system as the feature graphic — lockup, tagline, the `fan`, one hero capture — but
 * not the same picture scaled up, because these are CROPPED by the store and the feature graphic is
 * not. One file is shown differently on iPhone and iPad and in each orientation, and Apple's only
 * published rule is "be sure your focal point artwork is within the center of your composition". Its
 * templates are more exact: each canvas carries an ART SAFE AREA (`safe` on the target, see specs.mjs),
 * and that rectangle is what this layout is built around:
 *
 *   - the lockup and tagline sit wholly INSIDE it, in its left part, sized to fit it;
 *   - the hero sits in its right part, and may run past its right edge and a little above and below
 *     it, so the half nearest the words is always the half that survives a crop;
 *   - the fan stands in the margin to the LEFT of it, rising from the bottom edge — decoration, which
 *     the widest view shows and a narrow crop may lose without the picture losing its point.
 *
 * The hero should be a LANDSCAPE capture where the app has one. A phone frame squeezed into a 21:9
 * strip is a small upright rectangle in a sea of matte; a real landscape table fills the strip and is
 * the "firsthand experience" Apple asks the search image to show. A landscape hero is drawn as the
 * screen itself — rounded, shadowed, no bezel — so a capture taken on any device advertises no
 * particular hardware (Apple: "Don't include logos or references to other platforms"); `frame` asks
 * for a body by name when one is wanted. A portrait hero gets the iPhone frame by default.
 *
 * Not drawn here, on purpose: `brand.endsub`. It is the honest-offer line ("Free · no ads") of the end
 * card and the feature graphic, and Apple's guidance for these assets rules out pricing and asks for
 * "a short phrase that enhances your visual rather than describes it" — the tagline is that phrase.
 * The pixel knobs of the feature graphic (`fanX`/`fanY`/`fanHeight`, `textOffsetY`) do not apply
 * either: they are pixels of a 1024×500 canvas, and this layout is placed from the safe area instead.
 */

/** Text column's share of the safe area's width; the hero takes the rest. */
const TEXT_SHARE = 0.44;
/** Block proportions, in units of the icon size k: wordmark, gap under the lockup, tagline size. */
const WORDMARK = 0.83; // the feature graphic's 76px type on a 92px icon
const LOCKUP_GAP_BELOW = 0.55;
const TAGLINE = 0.52; // the feature graphic's 48px on 92
const TAGLINE_LH = 1.2;

/**
 * Where everything goes, as pure geometry, so the safe-area promise is testable without drawing.
 * `heroAspect` is the hero SCREEN's height/width; `framed` leaves room for a body around it.
 * Every rect is `{ x, y, w, h }` in canvas pixels; `fan` is the point its cards stand on, and a height.
 */
export function creativeLayout({ W, H, safe, heroAspect, framed = false, hand = 'margin', cards = 3, cardAspect = 0.73 }) {
  if (hand === 'below') return handBelowLayout({ W, H, safe, heroAspect, framed, cards, cardAspect });
  const [sx, sy, sw, sh] = safe;
  const pad = Math.round(sw * 0.03);
  const text = { x: sx + pad, y: sy + pad, w: Math.round(sw * TEXT_SHARE - pad * 1.5), h: sh - pad * 2 };

  // The hero's box starts after the text column and may reach the canvas's own margin on the right and
  // 15% of the safe height past the safe area above and below. A body is ~7% bigger than its screen.
  const k = framed ? 1.07 : 1;
  const x0 = sx + Math.round(sw * TEXT_SHARE) + pad;
  const boxW = W - Math.round(W * 0.04) - x0;
  const boxH = sh * 1.3;
  let w = boxW / k;
  let h = w * heroAspect;
  if (h > boxH / k) {
    h = boxH / k;
    w = h / heroAspect;
  }
  const outerW = w * k;
  const outerH = h * k;
  // A hero that fits in what is left of the safe area is centred in it; one that does not starts at
  // the column and runs out to the right, so its part nearest the words is the part that is safe.
  const room = sx + sw - x0;
  const ox = outerW <= room ? x0 + (room - outerW) / 2 : x0;
  const hero = { x: Math.round(ox), y: Math.round(sy + sh / 2 - outerH / 2), w: Math.round(outerW), h: Math.round(outerH) };

  // The fan is decoration, so it goes OUTSIDE the safe area, in whichever margin holds the bigger cards:
  // the one to the left of it, or the band below the words. Either way its cards run off the bottom
  // edge, like a hand held below the table — the part a crop loses first is the part that matters
  // least. Sized so it never reaches the words: three cards at 52% overlap span about twice one card,
  // and a card is about 0.73 as wide as it is tall, so a fan is ~1.5× as wide as it is tall.
  const sink = 0.12; // how far below the bottom edge the cards stand
  const leftH = Math.min(H * 0.5, sx * 0.6);
  const band = H - (sy + sh);
  const belowH = Math.min(band / (1 - sink), (text.w * 1.1) / 1.5);
  const fan = leftH >= belowH
    ? { cx: Math.round(sx * 0.46), cy: Math.round(H + leftH * sink), h: Math.round(leftH) }
    : { cx: Math.round(text.x + text.w / 2), cy: Math.round(H + belowH * sink), h: Math.round(belowH) };
  return { safe: { x: sx, y: sy, w: sw, h: sh }, text, hero, fan };
}

/**
 * The hand below (`hand: 'below'` on the shot): the words and the hero as ONE group centred across the
 * upper part of the canvas, and a hand of cards centred along the bottom, rising from below the edge.
 *
 * Asked for from a real listing (Vinto, 2026-10-12). The margin hand stood wholly outside the safe area
 * most devices show and had a card cut off at the canvas's side — "7 in bottom left is truncated to the
 * left". Centred, the hand is the part every crop keeps rather than the part it loses: it is sized so
 * its widest card stays inside the iPhone's crop (Apple's Preview tool keeps the full height and loses
 * about 8% each side), and only the bottom edge cuts it, which reads as a hand held below the table.
 *
 * `fan` returns where the cards stand (`cy`, below the bottom edge), their height and the hand's whole
 * width (`span`, rotation included) so the promise can be tested without drawing.
 */
const HAND = { height: 0.46, showing: 0.6, step: 0.66, spread: 0.08, arc: 0.05 };
/** The share of the width the hand may span: the iPhone's crop, 8% each side. */
const HAND_REACH = 0.84;
const GROUP = { top: 0.036, gap: 0.035, words: 0.2, between: 0.036, widest: 0.92 };

function handBelowLayout({ W, H, safe, heroAspect, framed, cards, cardAspect }) {
  const [sx, sy, sw, sh] = safe;
  const mid = (cards - 1) / 2;
  const tilt = mid * HAND.spread;
  // How wide the hand is per unit of card height: the outer card's centre, then its rotated top corner.
  const reachPerH = mid * cardAspect * HAND.step + (cardAspect / 2) * Math.cos(tilt) + Math.sin(tilt);
  const fanH = Math.floor(Math.min(H * HAND.height, (W * HAND_REACH) / (2 * reachPerH)));
  const fan = {
    cx: Math.round(W / 2),
    cy: Math.round(H + fanH * (1 - HAND.showing)),
    h: fanH,
    span: Math.round(2 * reachPerH * fanH),
    step: HAND.step,
    spread: HAND.spread,
    arc: HAND.arc,
  };

  // The group stands in what the hand leaves above it.
  const top = Math.round(H * GROUP.top);
  const bottom = Math.round(H - fanH * HAND.showing - H * GROUP.gap);
  const k = framed ? 1.07 : 1;
  const wordsW = Math.round(W * GROUP.words);
  const between = Math.round(W * GROUP.between);
  let heroH = (bottom - top) / k;
  let heroW = heroH / heroAspect;
  const room = W * GROUP.widest - wordsW - between;
  if (heroW * k > room) {
    heroW = room / k;
    heroH = heroW * heroAspect;
  }
  const outerW = Math.round(heroW * k);
  const outerH = Math.round(heroH * k);
  const gx = Math.round((W - (wordsW + between + outerW)) / 2);
  const y = Math.round(top + (bottom - top - outerH) / 2);
  const text = { x: gx, y, w: wordsW, h: outerH };
  const hero = { x: gx + wordsW + between, y, w: outerW, h: outerH };
  return { safe: { x: sx, y: sy, w: sw, h: sh }, text, hero, fan };
}

/**
 * Fit the lockup and tagline into `box`: the largest icon size k at which every line fits the width and
 * the whole block fits the height. Returns what to draw; nothing is drawn here.
 *
 * Each sentence of the tagline keeps its own line if it can. Wrapping is the fallback for a sentence
 * too long to set at a readable size, and only taken when it buys a third more size: "Hold less. /
 * Know more." broken into "Know / more." to gain a few pixels reads as a mistake, while a German
 * sentence twice as long genuinely needs the second line.
 */
function fitIdentity(ctx, brand, hasLogo, box) {
  const name = brand.name || 'App';
  const gap = Number.isFinite(brand.lockupGap) ? brand.lockupGap : 0.28; // the feature graphic's 26px on 92
  const parts = splitTagline(brand.tagline).filter(Boolean);
  const blockH = (n) => 1 + (n ? LOCKUP_GAP_BELOW + n * TAGLINE * TAGLINE_LH : 0);
  ctx.font = font(100 * WORDMARK, 'bold');
  const lockupW100 = (hasLogo ? 100 + 100 * gap : 0) + ctx.measureText(name).width;
  const kMax = Math.min(box.h / blockH(parts.length), (box.w * 100) / lockupW100);

  // One line per sentence: shrink until the widest sentence fits.
  ctx.font = font(100 * TAGLINE, 'bold');
  const widest100 = Math.max(1, ...parts.map((p) => ctx.measureText(p).width));
  const kWhole = Math.min(kMax, (box.w * 100) / widest100);
  const whole = parts.map((text, j) => ({ text, second: j > 0 }));

  // Wrapped: the size settles as the line count does (fewer lines → bigger type → more wrapping).
  let k = kMax;
  let lines = whole;
  for (let i = 0; i < 6; i++) {
    ctx.font = font(Math.round(k * TAGLINE), 'bold');
    lines = parts.flatMap((p, j) => wrapLines(ctx, p, box.w).map((text) => ({ text, second: j > 0 })));
    // A single word wider than the column cannot wrap: shrink to it.
    const w = Math.max(0, ...lines.map((l) => ctx.measureText(l.text).width));
    const next = Math.min(k, w > box.w ? k * (box.w / w) : k, box.h / blockH(lines.length));
    if (next >= k - 0.5) break;
    k = next;
  }
  const useWhole = kWhole >= k * 0.75;
  const kk = Math.floor(useWhole ? kWhole : k);
  const chosen = useWhole ? whole : lines;
  return { k: kk, name, gap, lines: chosen, height: kk * blockH(chosen.length) };
}

/** The hero: the screen itself on the matte, or inside a named frame. `rect` is the outer box. */
function drawHero(ctx, img, rect, frame) {
  const draw = frame && frame !== 'none' ? frameFor(frame) : null;
  if (draw) {
    draw(ctx, img, rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w / 1.07);
    return;
  }
  const r = Math.round(Math.min(rect.w, rect.h) * 0.035);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = Math.round(rect.w * 0.035);
  ctx.shadowOffsetY = Math.round(rect.w * 0.012);
  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, r);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, r);
  ctx.clip();
  // The rect already has the capture's aspect, so this is a plain scale, not a crop.
  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

/** A rectangle of an image, as a canvas of its own: what `heroCrop` asks for. */
function cropped(img, [x, y, w, h]) {
  const c = createCanvas(w, h);
  c.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h);
  return c;
}

/**
 * Build one App Store creative asset → a no-alpha PNG. `safe` is the art safe area in THIS canvas's
 * pixels (the caller scales the target's when a `size:` override changes the canvas). `frame`: a frame
 * id for the hero, `'none'` for the bare screen; unset picks by the hero's shape (see above).
 * `fan: false` leaves the cards out; a list of paths deals those cards instead of `brand.fan`.
 * `hand: 'below'` centres the words and hero over a hand rising from the bottom edge ([handBelowLayout]).
 * `heroCrop: [x, y, w, h]` takes that rectangle of the capture, in its pixels, as the hero — the table
 * alone, say, without the app's header and controls around it.
 */
export async function buildCreativeGraphic({ W, H, safe, brand, theme, heroPath, outFile, frame, fan = true, hand = 'margin', heroCrop }) {
  const th = ground(theme);
  const whole = heroPath && fs.existsSync(heroPath) ? await loadImage(heroPath) : null;
  const hero = whole && heroCrop ? cropped(whole, heroCrop) : whole;
  const heroFrame = frame ?? (hero && hero.height > hero.width ? 'phone' : 'none');
  const framed = heroFrame !== 'none' && !!frameFor(heroFrame);
  const aspect = hero ? screenAspectFor(heroFrame, hero) : 9 / 16;
  const cards = Array.isArray(fan) ? fan : brand.fan;
  const dealt = (cards || []).filter((f) => fs.existsSync(f));
  const first = dealt.length ? await loadImage(dealt[0]) : null;
  const lay = creativeLayout({
    W, H, safe, heroAspect: aspect, framed, hand,
    cards: Math.max(1, dealt.length), cardAspect: first ? first.width / first.height : 0.73,
  });

  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  fillVerticalGradient(ctx, W, H, th.matteTop, th.matteBottom);
  // The glow sits where the words meet the hero, so the light falls on the part every crop keeps.
  radialGlow(ctx, lay.hero.x, lay.safe.y + lay.safe.h / 2, Math.max(W, H) * 0.5, th.glow || brand.sub, th.glowAlpha);

  if (fan !== false) {
    await drawFan(ctx, cards, {
      cx: lay.fan.cx, cy: lay.fan.cy, h: lay.fan.h,
      step: lay.fan.step, arc: lay.fan.arc,
      spread: lay.fan.spread ?? brand.fanSpread ?? 0.17,
      blur: Math.round(lay.fan.h * 0.06), // the feature graphic's 18px on its 300px cards
      offsetY: Math.round(lay.fan.h * 0.02),
    });
  }
  if (hero) drawHero(ctx, hero, lay.hero, heroFrame);

  const logo = brand.logo && fs.existsSync(brand.logo) ? await loadImage(brand.logo) : null;
  const id = fitIdentity(ctx, brand, !!logo, lay.text);
  const { k } = id;
  let y = Math.round(lay.text.y + (lay.text.h - id.height) / 2);
  const x = lay.text.x;
  if (logo) {
    ctx.save();
    roundRectPath(ctx, x, y, k, k, k * 0.22);
    ctx.clip();
    ctx.drawImage(logo, x, y, k, k);
    ctx.restore();
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = font(Math.round(k * WORDMARK), 'bold');
  ctx.fillStyle = brand.title;
  ctx.fillText(id.name, x + (logo ? k + k * id.gap : 0), y + k / 2 + k * 0.04);
  y += k;
  if (id.lines.length) {
    y += k * LOCKUP_GAP_BELOW;
    ctx.textBaseline = 'top';
    ctx.font = font(Math.round(k * TAGLINE), 'bold');
    for (const line of id.lines) {
      // The tagline's second sentence in the accent colour, as on the feature graphic.
      ctx.fillStyle = line.second ? brand.sub : brand.title;
      ctx.fillText(line.text, x, y);
      y += k * TAGLINE * TAGLINE_LH;
    }
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, rgbPngBuffer(c));
  return { outFile, W, H, layout: lay };
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
