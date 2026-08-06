/**
 * LAYOUT stills — several captures composed into ONE store shot: the "works on every device" page.
 *
 * The other styles in `still.mjs` render one capture per slot. This one takes a list of members, each
 * with its own capture and its own device frame, and arranges them on the brand matte under a shared
 * caption. It is how a phone, a tablet and a laptop end up in a single cluster without any of them
 * being drawn inside another device's bezel.
 *
 * WHY FRACTIONAL COORDINATES. Every position and width is a fraction of the OUTPUT canvas, never a
 * pixel. The same layout therefore renders correctly into an App Store 6.9" slot (1320×2868, portrait)
 * and a Play large-screen slot (2560×1440, landscape) without being re-authored — which is the whole
 * point, since a device cluster is exactly the asset an app wants in several stores at once. Authors
 * who need per-slot nudges override `x`/`y`/`w` on the screenshot spec rather than forking the scene.
 *
 * PAINTER ORDER is array order: the first member is furthest back, the last sits in front. That is the
 * only depth control, and it is deliberate — a z-index would invite authors to fight the array instead
 * of reading it top to bottom.
 *
 * DEGRADES MEMBER-WISE. A member whose capture is missing is skipped and the rest still render, so a
 * cluster is safe to configure before every platform has been captured. The caller reports what was
 * dropped; nothing is silently thinned.
 */
import { createCanvas } from '@napi-rs/canvas';
import { frameFor } from './frames.mjs';
import { loadCapture } from './statusbar.mjs';
import { paintMatte, paintVignette, drawLabel, drawHandle, resolvePremiumTheme } from './premium.mjs';

/** Defaults for a member that says only where it goes. */
const MEMBER_DEFAULTS = { x: 0.5, y: 0.55, w: 0.3, frame: 'phone', tilt: 0 };

/**
 * Resolve one member's geometry against the canvas. Returns pixel centre + screen width, so the frame
 * drawers (which all take `(ctx, img, cx, cy, screenW)`) can be used unchanged.
 */
function place(member, W, H) {
  const m = { ...MEMBER_DEFAULTS, ...member };
  return { cx: W * m.x, cy: H * m.y, screenW: W * m.w, tilt: ((m.tilt ?? 0) * Math.PI) / 180, frame: m.frame };
}

/**
 * Compose a layout still.
 *
 * `members` are ALREADY-LOADED images paired with their placement — the caller resolves and loads them
 * (and drops the missing ones) so this stays a pure renderer with no filesystem in it.
 */
/**
 * How much bigger than the target the scratch layer is, per side. Members are placed as fractions of the
 * TARGET, but a body, its shadow or a deck can legitimately extend past those fractions — a watch at
 * `y: 0.88` hangs below the bottom edge. Painting at exactly W×H would clip that overhang away BEFORE
 * `paintedBounds` measured it, and the fit would then happily centre a cluster whose watch had already
 * lost its lower half. The margin gives every member room to land whole.
 */
const LAYER_PAD = 0.5;

/** Paint every member onto a transparent, over-sized layer, in array order (first = furthest back). */
function paintCluster(W, H, members) {
  const padX = Math.round(W * LAYER_PAD);
  const padY = Math.round(H * LAYER_PAD);
  const layer = createCanvas(W + padX * 2, H + padY * 2);
  const ctx = layer.getContext('2d');
  ctx.translate(padX, padY); // members keep addressing the TARGET's coordinate space
  for (const { img, placement } of members) {
    const { cx, cy, screenW, tilt, frame } = placement;
    const draw = frameFor(frame);
    ctx.save();
    if (tilt !== 0) {
      ctx.translate(cx, cy);
      ctx.rotate(tilt);
      ctx.translate(-cx, -cy);
    }
    if (draw) {
      // Every frame drawer takes (ctx, img, cx, cy, screenW) — including the watch, whose fifth argument
      // is a diameter, which is the same "how wide is the screen" quantity for a round body.
      draw(ctx, img, cx, cy, screenW);
    } else {
      // No frame for this id (e.g. 'mac', whose captures already carry window chrome) — draw the capture
      // itself at the requested width, centred on the placement, preserving its aspect.
      const h = screenW * (img.height / img.width);
      ctx.drawImage(img, Math.round(cx - screenW / 2), Math.round(cy - h / 2), Math.round(screenW), Math.round(h));
    }
    ctx.restore();
  }
  return layer;
}

/**
 * Bounding box of everything actually painted on a transparent layer, by alpha. Frame-agnostic on
 * purpose: bodies, shadows and keyboard decks all have different overhangs, and asking each drawer to
 * report its extent would mean a new contract for every frame anyone adds later.
 */
function paintedBounds(layer) {
  const { width: w, height: h } = layer;
  const { data } = layer.getContext('2d').getImageData(0, 0, w, h);
  let minX = w; let minY = h; let maxX = -1; let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 8) { // ignore the faintest shadow fringe
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function layoutStill({ W, H, members, caption, brand, theme }) {
  const th = resolvePremiumTheme(brand, theme);
  // A cluster is a caption-on-top layout by default, like the store stills: the devices need the lower
  // two thirds, and a bottom pill would collide with whichever member sits lowest.
  if (theme?.captionAnchor === undefined) th.captionAnchor = 'top';

  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  paintMatte(ctx, W, H, th);

  /* AUTO-FIT — what makes one layout serve every slot.
   *
   * Member placements are fractions of the canvas, so a cluster authored against a landscape slot draws
   * small and adrift in a portrait one (width shrinks, height does not) and vice versa. Rather than make
   * authors re-place the same cluster per slot — which is the thing this feature exists to avoid — the
   * cluster is painted to its own layer, measured, and scaled to fill the content band under the caption
   * with its internal geometry intact. The arrangement is authored once; only its overall size adapts.
   *
   * `theme.clusterFit: false` turns this off for an author who really does want raw fractions.
   */
  const layer = paintCluster(W, H, members);
  const bounds = th.clusterFit === false ? null : paintedBounds(layer);
  if (!bounds) {
    // Raw fractions (`clusterFit: false`): undo the scratch margin so placements land where authored.
    ctx.drawImage(layer, Math.round(W * LAYER_PAD), Math.round(H * LAYER_PAD), W, H, 0, 0, W, H);
  } else {
    const pad = th.clusterPad ?? 0.06; // matte margin around the cluster, as a fraction of the short side
    const m = Math.min(W, H) * pad;
    // A shot with `caption: false` — what Google Play asks for — has no headline to make room for, so the
    // cluster takes the whole frame. Reserving the band regardless left a blank third above it.
    const captioned = Boolean(caption?.title || caption?.sub);
    const topCaption = captioned && th.captionAnchor === 'top';
    // The caption occupies roughly the top tenth; reserving a third left an obvious void between the
    // headline and the cluster on tall slots. `theme.clusterTop` moves the band for a longer headline.
    const bandY = topCaption ? H * (th.clusterTop ?? 0.22) : m;
    const bandH = (topCaption ? H - bandY : (captioned ? H * 0.74 : H - m)) - m;
    const bandX = m;
    const bandW = W - m * 2;
    const scale = Math.min(bandW / bounds.w, bandH / bounds.h);
    const dw = bounds.w * scale;
    const dh = bounds.h * scale;
    ctx.drawImage(
      layer,
      bounds.x, bounds.y, bounds.w, bounds.h,
      Math.round(bandX + (bandW - dw) / 2), Math.round(bandY + (bandH - dh) / 2), Math.round(dw), Math.round(dh),
    );
  }

  drawLabel(ctx, W, H, caption, th, 1);
  paintVignette(ctx, W, H, th.vignette);
  drawHandle(ctx, W, H, th.handle, th.labelColor);
  return c;
}

/**
 * Load a scene's layout members, skipping the ones whose capture is absent.
 * Returns `{ members, missing }` — `missing` is the caller's to report.
 */
export async function loadLayoutMembers(layout, { W, H, theme, exists }) {
  const members = [];
  const missing = [];
  for (const member of layout) {
    if (!exists(member.image)) {
      missing.push(member.image);
      continue;
    }
    // Per-member `statusBar`/`frame` overrides ride on the member, falling back to the shot's theme —
    // a phone in a cluster still wants its clean status bar, and it is captured per platform.
    const img = await loadCapture(member.image, { ...theme, ...(member.statusBar !== undefined && { statusBar: member.statusBar }) }, member.frame);
    members.push({ img, placement: place(member, W, H) });
  }
  return { members, missing };
}
