/**
 * Synthetic status bar for captures that reserve the inset but don't contain the system UI.
 *
 * WHY: an Android Compose instrumentation capture (`captureToImage()`) grabs the APP's window only. An
 * edge-to-edge app still pads for the status bar, so the shot carries an empty band where the clock and
 * battery should be — the system UI lives in a separate window and never lands in the PNG. iOS XCUITest
 * captures the whole screen, so its shots already have one; this closes the gap.
 *
 * Google asks for exactly this state: "Edit excess elements in the notification bar before submitting. Do
 * not show service providers or notifications. The battery, WiFi, and cell service logos should be full."
 * (Play Console Help — preview assets.) Android ships SystemUI *demo mode* for the same purpose; drawing
 * the bar at compose time gets the identical result without re-capturing.
 *
 * Nothing is ever drawn over app pixels: the band is detected as a run of IDENTICAL rows at the top, and
 * the bar is painted only inside it.
 *
 * The closed iPhone Duo has no bar at all. iOS 27.1 stands its status in a COLUMN down the right edge
 * (`statusBar: 'column'`, `drawStatusColumn`), detected the same way: a run of identical columns at the
 * right, and nothing painted unless the whole of what is painted fits inside it.
 */
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { roundRectPath, font } from './canvas.mjs';

/** 9:41 — Apple's keynote time, and the de-facto marketing convention on both stores. */
const DEFAULT_TIME = '9:41';

/**
 * Height in px of the uniform band at the top of an image, or 0 if there isn't a plausible one.
 * Bounded to 2–15% of the height: below that it's a coincidence (one flat row), above it the image is
 * mostly empty and we'd be guessing.
 */
export function detectBlankBand(ctx, W, H) {
  const data = ctx.getImageData(0, 0, W, Math.ceil(H * 0.16)).data;
  const at = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const [r0, g0, b0] = at(0, 0);
  const same = (c) => Math.abs(c[0] - r0) <= 3 && Math.abs(c[1] - g0) <= 3 && Math.abs(c[2] - b0) <= 3;
  const step = Math.max(1, Math.floor(W / 64)); // sample the row rather than reading every pixel
  let y = 0;
  const maxY = Math.floor(H * 0.15);
  for (; y < maxY; y++) {
    let uniform = true;
    for (let x = 0; x < W; x += step) {
      if (!same(at(x, y))) { uniform = false; break; }
    }
    if (!uniform) break;
  }
  return y >= H * 0.02 ? y : 0;
}

/** Perceived luminance → pick glyph colour that reads on the band it sits in. */
const isLight = ([r, g, b]) => (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;

/**
 * Paint a clean status bar into the band: time on the left, cell + wifi + full battery on the right.
 * Vector-drawn (no font/icon assets), scaled to the band so it looks native at any density.
 */
export function drawStatusBar(ctx, W, bandH, { time = DEFAULT_TIME, color = '#0b0b0a', cellular = true } = {}) {
  // Sit low enough in the strip to clear a device's corner radius, and inset far enough horizontally
  // that the clock and the battery aren't chewed by the rounded corners of the screen cutout.
  const cy = bandH * 0.62;
  const fs = Math.round(bandH * 0.36);
  const pad = Math.round(W * 0.08);

  ctx.save();
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = font(fs, '600'); // the registered brand/system face, same as every other caption
  ctx.fillText(time, pad, cy);

  // ── right cluster, laid out right-to-left ──
  const u = bandH * 0.3; // glyph unit
  let x = W - pad;

  // Battery: rounded body, nub, full fill.
  const bw = u * 1.85;
  const bh = u * 0.92;
  const r = bh * 0.28;
  x -= bw;
  const by = cy - bh / 2;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = Math.max(1, bh * 0.1);
  ctx.strokeStyle = color;
  roundRectPath(ctx, x, by, bw, bh, r);
  ctx.stroke();
  roundRectPath(ctx, x + bw + bh * 0.08, cy - bh * 0.16, bh * 0.12, bh * 0.32, bh * 0.06); // nub
  ctx.fill();
  ctx.globalAlpha = 1;
  const inset = bh * 0.16;
  roundRectPath(ctx, x + inset, by + inset, bw - inset * 2, bh - inset * 2, r * 0.6); // full charge
  ctx.fill();

  // Wi-Fi: three arcs + dot.
  x -= u * 1.5;
  ctx.lineWidth = Math.max(1, u * 0.16);
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let i = 2; i >= 1; i--) {
    ctx.beginPath();
    ctx.arc(x, cy + u * 0.42, u * 0.34 * i, Math.PI * 1.25, Math.PI * 1.75);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(x, cy + u * 0.34, u * 0.12, 0, Math.PI * 2);
  ctx.fill();

  // Cell signal: four full bars, drawn LEFT-to-right from this anchor, so the anchor must clear the
  // wifi glyph by the bars' full width (1.44u) plus a gap — not the 1.9u that had them touching. A Wi-Fi-only tablet
  // showing signal bars is a detail that's simply false, and Google asks for a status bar that reflects
  // the device ("do not show service providers"), not a decorative one.
  if (cellular) {
    x -= u * 2.6;
    const bars = 4;
    const bwid = u * 0.22;
    const gap = u * 0.14;
    for (let i = 0; i < bars; i++) {
      const h = u * (0.3 + i * 0.22);
      roundRectPath(ctx, x + i * (bwid + gap), cy + u * 0.5 - h, bwid, h, bwid * 0.35);
      ctx.fill();
    }
  }
  ctx.restore();
}

// ─── The status column: the closed iPhone Duo, iOS 27.1 ─────────────────────────────────────────────
//
// Measured on the iPhone Duo simulator (Xcode 27.1 RC, iOS 27.1 runtime, 2026-10-12), in points. The
// closed display is 466×678 pt; iOS reserves a column 84 pt wide down the RIGHT edge, full height, and
// nothing across the top, so the app's safe area is the other 382. Top to bottom the column holds the
// camera (a punch-hole in the glass: hardware, unmeasured, and never drawn — inventing a detail Apple
// does not publish is exactly what the frames refuse to do), the clock, then one round glyph: Wi-Fi inside
// a ring that is the battery, whose open foot carries the cell signal as four dots. Below that the column
// is the app's, which is why only the top of it has to be empty.
//
// What the simulator shows that a store shot must not: it charges (a green ring, broken at the top by a
// bolt) and has no SIM (four grey dots). A shot gets what the bar gets — a full battery and full signal,
// as Google asks and Apple's own marketing shows — so the ring is closed over the top and drawn in the
// glyph colour, like every other battery zdymak draws, and the dots are solid.

/** The closed Duo's display width, in points: the column is sized from the capture's width over this. */
const DUO_OUTER_PT = 466;

/**
 * The column's geometry, in points. `cx` is from the RIGHT edge, every `y` from the top. The glyphs are
 * not centred in the 84-pt column: they sit 36 pt in from its left edge (48 from the right), measured.
 */
const COLUMN = {
  width: 84, // the reserved column
  cx: 48, // the glyphs' shared centre line
  timeBaseline: 98.8, // the clock's baseline: its digits stand 86.8–98.8, 12 pt tall and 41 wide
  timeSize: 16.67, // the clock's size in SF, which with `timeWeight` matches those digits
  timeWeight: 650, // heavier than the bar's semibold, as the column's clock is
  ringY: 128.3, // the ring's centre
  ringR: 18.67, // the ring's centre line (40.5 pt across outside)
  ringW: 3.2, // the ring's stroke
  ringOpen: 55, // degrees either side of straight down where the ring's round ends sit
  dotR: 2, // the signal dots: 4 pt across
  dotOrbit: 20.6, // on a circle just outside the ring's centre line
  dots: [-29, -9.7, 9.7, 29], // degrees from straight down
  wifiDrop: 8.67, // Wi-Fi's apex, below the ring's centre
  wifiWedge: 4.33, // the filled wedge's radius
  wifiArcs: [7.67, 12.25], // the two arcs' centre lines
  wifiW: 2.75, // the arcs' stroke
  bottom: 160, // everything painted ends above this (the lowest dot ends at 150.6)
  margin: 2, // clear space the glyphs keep from the app's pixels beside them
};

/**
 * Width in px of the uniform band down the RIGHT edge over the top `rows` rows, or 0 if there isn't a
 * plausible one. The column's twin of `detectBlankBand`: a column of pixels counts only if EVERY pixel in
 * it matches the top-right corner (no sampling — a clock's hairline must not slip between samples), and a
 * band narrower than 2% of the width is a coincidence. Bounded to 40% of the width.
 */
export function detectBlankColumn(ctx, W, H, rows = H) {
  const h = Math.max(1, Math.min(H, Math.ceil(rows)));
  const span = Math.max(1, Math.floor(W * 0.4));
  const data = ctx.getImageData(W - span, 0, span, h).data;
  const at = (x, y) => { const i = (y * span + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const [r0, g0, b0] = at(span - 1, 0);
  const same = (c) => Math.abs(c[0] - r0) <= 3 && Math.abs(c[1] - g0) <= 3 && Math.abs(c[2] - b0) <= 3;
  let w = 0;
  scan: for (; w < span; w++) {
    const x = span - 1 - w;
    for (let y = 0; y < h; y++) if (!same(at(x, y))) break scan;
  }
  return w >= W * 0.02 ? w : 0;
}

/** Degrees → radians. */
const rad = (deg) => (deg * Math.PI) / 180;

/**
 * Set the clock's face on `ctx` and return a function that puts the variation back. The weight is set
 * twice on purpose: as a variation, which San Francisco (a variable font, registered at one weight) obeys
 * and a static face ignores, and in the font string, which a static face takes as a synthetic bold.
 */
function clockFace(ctx, s) {
  ctx.font = font(COLUMN.timeSize * s, '600');
  const before = ctx.fontVariationSettings;
  ctx.fontVariationSettings = `'wght' ${COLUMN.timeWeight}`;
  return () => { ctx.fontVariationSettings = before; };
}

/**
 * How far from the right edge, in px, the column's glyphs reach — the clock or the ring, whichever is
 * wider — plus the margin they keep. The band has to be at least this wide for anything to be drawn.
 */
function columnReach(ctx, W, time) {
  const s = W / DUO_OUTER_PT;
  ctx.save();
  const restore = clockFace(ctx, s);
  const half = Math.max(ctx.measureText(time).width / 2, (COLUMN.ringR + COLUMN.ringW / 2) * s);
  restore();
  ctx.restore();
  return Math.ceil(COLUMN.cx * s + half + COLUMN.margin * s);
}

/**
 * Paint the closed Duo's status column: the clock, then Wi-Fi inside a full battery ring, with four
 * signal dots in its foot when `cellular`. Vector-drawn like the bar, and sized from the capture's width
 * as the Duo's 466 pt, never from the band it found — two screens with different margins must not get
 * different clocks.
 */
export function drawStatusColumn(ctx, W, { time = DEFAULT_TIME, color = '#0b0b0a', cellular = true } = {}) {
  const s = W / DUO_OUTER_PT;
  const cx = W - COLUMN.cx * s;

  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const restore = clockFace(ctx, s);
  ctx.fillText(time, cx, COLUMN.timeBaseline * s);
  restore();

  // The battery: a ring open at the foot, its round ends 55° either side of straight down. Canvas angles
  // run clockwise from +x, so straight down is 90° and the ring sweeps from 145° over the top to 35°.
  const cy = COLUMN.ringY * s;
  ctx.lineCap = 'round';
  ctx.lineWidth = COLUMN.ringW * s;
  ctx.beginPath();
  ctx.arc(cx, cy, COLUMN.ringR * s, rad(90 + COLUMN.ringOpen), rad(90 - COLUMN.ringOpen));
  ctx.stroke();

  // The cell signal: four dots along the ring's open foot. A Wi-Fi-only capture leaves the foot open.
  if (cellular) {
    for (const a of COLUMN.dots) {
      ctx.beginPath();
      ctx.arc(cx + COLUMN.dotOrbit * s * Math.sin(rad(a)), cy + COLUMN.dotOrbit * s * Math.cos(rad(a)), COLUMN.dotR * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Wi-Fi: a filled wedge and two arcs, all cut by the same lines 45° either side of straight up. A round
  // cap reaches past its arc's end by half the stroke, so each arc stops that much short of the line.
  const ay = cy + COLUMN.wifiDrop * s;
  const up = 270;
  const j = 0.8 * s; // the wedge's corners are rounded by stroking it with a round join
  const wy = ay - (j / 2) * Math.SQRT2; // ...which fattens it by j/2, so its apex moves up to keep the tip
  ctx.lineWidth = j;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, wy);
  ctx.arc(cx, wy, COLUMN.wifiWedge * s - j, rad(up - 45), rad(up + 45));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = COLUMN.wifiW * s;
  for (const r of COLUMN.wifiArcs) {
    const trim = (COLUMN.wifiW / 2 / r) * (180 / Math.PI);
    ctx.beginPath();
    ctx.arc(cx, ay, r * s, rad(up - 45 + trim), rad(up + 45 - trim));
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The column's half of `withStatusBar`. Portrait only: the column was measured on the closed Duo held
 * upright, and where iOS stands it in landscape has not been, so a landscape capture is left as it is.
 */
function withStatusColumn(canvas, opts) {
  const ctx = canvas.getContext('2d');
  const { width: W, height: H } = canvas;
  if (W >= H) return canvas;
  const time = opts.time || DEFAULT_TIME;
  const band = detectBlankColumn(ctx, W, H, (COLUMN.bottom * W) / DUO_OUTER_PT);
  if (!band || band < columnReach(ctx, W, time)) return canvas;
  const px = ctx.getImageData(W - 1, 0, 1, 1).data;
  drawStatusColumn(ctx, W, { ...opts, time, color: opts.color || (isLight(px) ? '#0b0b0a' : '#f5f5f4') });
  return canvas;
}

/**
 * If the capture reserves an empty status-bar band, fill it with a clean bar. Returns the canvas either
 * way, so callers can use it unconditionally.
 *
 * `mode`: 'auto' (default — only when a band is detected) · true (force, using a 6% band) · false (skip) ·
 * 'column' (the closed iPhone Duo's column down the right edge — only when that column is found empty).
 */
export function withStatusBar(canvas, mode = 'auto', opts = {}) {
  if (mode === false) return canvas;
  if (mode === 'column') return withStatusColumn(canvas, opts);
  const ctx = canvas.getContext('2d');
  const { width: W, height: H } = canvas;
  // A (near-)square capture is a watch face. Watches have no marketing status bar, and their corners fall
  // outside a round display — auto-detection would otherwise paint glyphs into the bezel. `true` still
  // forces one, for the rare square phone-ish capture.
  if (mode === 'auto' && Math.abs(W - H) / Math.max(W, H) < 0.1) return canvas;
  const detected = mode === true ? Math.round(H * 0.06) : detectBlankBand(ctx, W, H);
  if (!detected) return canvas;
  // Detection says WHETHER to draw; it must not decide how big. A sparse screen can leave a 200px band
  // and a dense one 90px — scaling the bar to that gives every screen a different-sized clock, which
  // reads as a mistake the moment two of them sit in the same reel. Real status bars are ~4% of height.
  const band = Math.min(detected, Math.round(H * 0.052)); // ≈48dp, a real status bar's height
  const px = ctx.getImageData(0, 0, 1, 1).data;
  drawStatusBar(ctx, W, band, { ...opts, color: opts.color || (isLight(px) ? '#0b0b0a' : '#f5f5f4') });
  return canvas;
}

/**
 * Load a capture with the status bar already painted in — the single entry point every renderer uses, so
 * a still and the video built from the same PNG can't disagree about whether the bar is there.
 */
export async function loadCapture(imgPath, theme, frame) {
  const img = await loadImage(imgPath);
  const mode = theme?.statusBar ?? 'auto';
  if (mode === false) return img;
  const c = createCanvas(img.width, img.height);
  c.getContext('2d').drawImage(img, 0, 0);
  // Cellular is inferred: tablets in our frame set are Wi-Fi models, and a landscape capture is a
  // tablet/desktop class. `statusBarCellular` overrides it for a cellular tablet.
  const inferred = !/ipad|tablet/.test(String(frame || '')) && img.height >= img.width;
  return withStatusBar(c, mode, {
    time: theme?.statusBarTime,
    cellular: theme?.statusBarCellular ?? inferred,
  });
}
