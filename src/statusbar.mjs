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

/**
 * If the capture reserves an empty status-bar band, fill it with a clean bar. Returns the canvas either
 * way, so callers can use it unconditionally.
 *
 * `mode`: 'auto' (default — only when a band is detected) · true (force, using a 6% band) · false (skip).
 */
export function withStatusBar(canvas, mode = 'auto', opts = {}) {
  if (mode === false) return canvas;
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
