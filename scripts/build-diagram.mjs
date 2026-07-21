#!/usr/bin/env node
/**
 * Render the README's capture-modes diagram — `docs/capture-modes.png`.
 *
 * Drawn in code rather than mocked up in a design tool so it can be regenerated when the modes change,
 * and so it can't drift out of sync with the CLI the way a hand-exported image would.
 *
 *   npm run docs:diagram
 */
import { createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { roundRectPath } from '../src/canvas.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = 1280;
const H = 560;
const SANS = '-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const INK = '#0b0b0a';
const MUTED = '#52606d';
const GREEN = '#15803d';

const c = createCanvas(W, H);
const x = c.getContext('2d');

// Background wash — the same pale green the store shots sit on.
const bg = x.createLinearGradient(0, 0, 0, H);
bg.addColorStop(0, '#e7f7ee');
bg.addColorStop(1, '#ffffff');
x.fillStyle = bg;
x.fillRect(0, 0, W, H);

const text = (s, px, py, { size = 20, weight = '400', colour = INK, align = 'left' } = {}) => {
  x.font = `${weight} ${size}px ${SANS}`;
  x.fillStyle = colour;
  x.textAlign = align;
  x.textBaseline = 'alphabetic';
  x.fillText(s, px, py);
};

const card = (px, py, w, h, { fill = '#ffffff', alpha = 1 } = {}) => {
  x.save();
  x.globalAlpha = alpha;
  x.shadowColor = 'rgba(16,40,26,0.10)';
  x.shadowBlur = 24;
  x.shadowOffsetY = 6;
  roundRectPath(x, px, py, w, h, 18);
  x.fillStyle = fill;
  x.fill();
  x.restore();
};

/** A right-pointing arrow with a label above it. */
const arrow = (px, py, len, label) => {
  x.save();
  x.strokeStyle = GREEN;
  x.lineWidth = 2.5;
  x.lineCap = 'round';
  x.beginPath();
  x.moveTo(px, py);
  x.lineTo(px + len - 10, py);
  x.stroke();
  x.beginPath();
  x.moveTo(px + len, py);
  x.lineTo(px + len - 13, py - 7);
  x.lineTo(px + len - 13, py + 7);
  x.closePath();
  x.fillStyle = GREEN;
  x.fill();
  x.restore();
  if (label) text(label, px + len / 2, py - 14, { size: 15, colour: GREEN, align: 'center', weight: '600' });
};

/** A folder glyph, drawn — Skia has no emoji font, so an emoji would render as a tofu box. */
const folder = (px, py, w) => {
  const h = w * 0.78;
  x.save();
  x.fillStyle = GREEN;
  roundRectPath(x, px, py + 6, w * 0.44, 8, 3); // tab
  x.fill();
  roundRectPath(x, px, py + 11, w, h, 6);
  x.fill();
  x.globalAlpha = 0.28;
  x.fillStyle = '#ffffff';
  roundRectPath(x, px + 4, py + 20, w - 8, h - 14, 4);
  x.fill();
  x.restore();
};

/** A miniature phone silhouette. */
const phone = (px, py, w, { label } = {}) => {
  const h = w * 2;
  x.save();
  roundRectPath(x, px, py, w, h, w * 0.16);
  x.fillStyle = INK;
  x.fill();
  roundRectPath(x, px + 3, py + 3, w - 6, h - 6, w * 0.14);
  x.fillStyle = '#f7faf8';
  x.fill();
  x.beginPath();
  x.arc(px + w / 2, py + 10, 2.4, 0, Math.PI * 2);
  x.fillStyle = INK;
  x.fill();
  x.restore();
  if (label) text(label, px + w / 2, py + h + 20, { size: 14, colour: MUTED, align: 'center' });
};

// ── Header ──────────────────────────────────────────────────────────────────────────────────────
text('Two ways to get your screenshots', 60, 62, { size: 34, weight: '700' });
text('zdymak composes store assets — and can take the screenshots itself.', 60, 94, { size: 19, colour: MUTED });

const COL_Y = 130;
const COL_H = 370;

// ── Mode A ──────────────────────────────────────────────────────────────────────────────────────
card(60, COL_Y, 540, COL_H);
text('Mode A', 92, COL_Y + 46, { size: 15, weight: '700', colour: GREEN });
text('Bring your own', 92, COL_Y + 78, { size: 26, weight: '700' });
text('Point screenshotsDir at any folder of PNGs.', 92, COL_Y + 108, { size: 17, colour: MUTED });

// folder → compose → asset
card(100, COL_Y + 150, 130, 150, { fill: '#eef2f0' });
folder(139, COL_Y + 186, 52);
text('Xcode · Figma', 165, COL_Y + 262, { size: 13, colour: MUTED, align: 'center' });
text('Android Studio', 165, COL_Y + 280, { size: 13, colour: MUTED, align: 'center' });

arrow(248, COL_Y + 225, 92, 'compose');

phone(372, COL_Y + 150, 74, { label: 'store asset' });

text('You produce the screenshots.', 92, COL_Y + 340, { size: 15, colour: MUTED });

// ── Mode B ──────────────────────────────────────────────────────────────────────────────────────
card(640, COL_Y, 580, COL_H);
text('Mode B', 672, COL_Y + 46, { size: 15, weight: '700', colour: GREEN });
text('zdymak drives your app', 672, COL_Y + 78, { size: 26, weight: '700' });
text('It walks every screen and captures each one.', 672, COL_Y + 108, { size: 17, colour: MUTED });

const rows = [
  ['iOS', 'boots a sim, builds, relaunches'],
  ['Android', 'adb intent, clean status bar'],
  ['Web', 'Playwright walks each URL'],
];
rows.forEach(([k, v], i) => {
  const py = COL_Y + 150 + i * 56;
  card(672, py, 320, 44, { fill: '#eef7f1' });
  text(k, 690, py + 28, { size: 16, weight: '700', colour: GREEN });
  text(v, 764, py + 27, { size: 13, colour: MUTED });
});

arrow(1016, COL_Y + 225, 58, 'capture');

phone(1104, COL_Y + 150, 74, { label: 'store asset' });

text('zdymak produces the screenshots, then composes them.', 672, COL_Y + 340, { size: 15, colour: MUTED });

// ── Footer note ─────────────────────────────────────────────────────────────────────────────────
text('Both modes end in the same place: framed, captioned, encoded to each store’s exact spec.',
  60, H - 24, { size: 16, colour: MUTED });

const out = path.join(root, 'docs/capture-modes.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, c.toBuffer('image/png'));
console.log(`✓ ${path.relative(root, out)} — ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
