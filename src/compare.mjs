/**
 * References and review: is a new shot the picture the owner of the listing already approved?
 *
 * One reference per store target and scene, in the source language only (English unless `sourceLocale` says
 * otherwise): `<references>/<target>/<scene>.png`, with `approvals.json` beside it recording who approved what and
 * when. A source-language shot is compared with its reference pixel by pixel. A shot in another language is compared
 * with the source-language reference by LAYOUT: both are reduced to cells, every cell that holds text in either picture
 * (read with the text reader, captions included) is left out, and a right-to-left language is compared with the
 * reference mirrored. Each measure has its own threshold in the config (`compare.pixel`, `compare.layout`); zdymak sets
 * neither, because a threshold is only honest above the noise measured between two captures of one build
 * (`zdymak compare --measure`).
 *
 * A shot beyond its threshold, a new source-language scene with no reference, or a shot of another size goes to
 * review (review.mjs).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readFacts } from './checker-device.mjs';
import { pixelsOf } from './checker.mjs';
import { readText } from './ocr.mjs';

/** The side of one layout cell, in pixels of the shot. */
export const LAYOUT_CELL = 16;
/** A cell moved when its mean colour differs by more than this on any channel (the launch check's tolerance). */
export const LAYOUT_TOLERANCE = 32;
/** Languages written right to left: their shots are compared with the source-language reference mirrored. */
export const RTL_LANGUAGES = ['ar', 'he', 'fa', 'ur', 'yi', 'ps', 'sd', 'ug', 'dv', 'ckb'];
/** The file in the references folder that records every approval. */
export const APPROVALS_FILE = 'approvals.json';

export const isRtl = (language) => RTL_LANGUAGES.includes(String(language || '').toLowerCase().split(/[-_]/)[0]);
const baseOf = (language) => String(language || '').toLowerCase().split(/[-_]/)[0];
export const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sceneOf = (file) => path.basename(file, path.extname(file));

/** A picture's pixels turned left for right. */
export function mirrored({ data, width: w, height: h }) {
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const d = (y * w + (w - 1 - x)) * 4;
      out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2]; out[d + 3] = data[s + 3];
    }
  }
  return { width: w, height: h, data: out };
}

/** Text boxes (fractions, origin top left) turned left for right. */
export const mirroredBoxes = (boxes) => boxes.map((b) => ({ ...b, x: 1 - b.x - b.w }));

/**
 * The share of pixels that differ at all between two pictures of one size, and which ones: `{ share, changed }`,
 * `changed` one byte per pixel.
 */
export function pixelDifference(a, b) {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`pixelDifference: ${a.width}x${a.height} against ${b.width}x${b.height}`);
  const n = a.width * a.height;
  const changed = new Uint8Array(n);
  let count = 0;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) { changed[p] = 1; count++; }
  }
  return { share: n ? count / n : 0, changed };
}

function cellMeans({ data, width: w, height: h }, cols, rows) {
  const means = new Float64Array(cols * rows * 3);
  const counts = new Uint32Array(cols * rows);
  for (let y = 0; y < h; y++) {
    const cy = Math.floor(y / LAYOUT_CELL);
    for (let x = 0; x < w; x++) {
      const c = cy * cols + Math.floor(x / LAYOUT_CELL);
      const i = (y * w + x) * 4;
      means[c * 3] += data[i]; means[c * 3 + 1] += data[i + 1]; means[c * 3 + 2] += data[i + 2];
      counts[c]++;
    }
  }
  for (let c = 0; c < counts.length; c++) for (let k = 0; k < 3; k++) means[c * 3 + k] /= counts[c] || 1;
  return means;
}

/**
 * How far two pictures' layouts differ: `{ share, moved, masked, cols, rows }`. Each picture is reduced to cells of
 * [LAYOUT_CELL] pixels; a cell any text box touches (`boxes`, fractions, from either picture) is left out; of the cells
 * left, `share` is those whose mean colour moved by more than [LAYOUT_TOLERANCE]. `moved` and `masked` are cell indexes.
 */
export function layoutDifference(a, b, boxes = []) {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`layoutDifference: ${a.width}x${a.height} against ${b.width}x${b.height}`);
  const cols = Math.ceil(a.width / LAYOUT_CELL);
  const rows = Math.ceil(a.height / LAYOUT_CELL);
  const mask = new Uint8Array(cols * rows);
  for (const bx of boxes) {
    const x0 = Math.max(0, Math.floor((bx.x * a.width) / LAYOUT_CELL));
    const x1 = Math.min(cols - 1, Math.floor(((bx.x + bx.w) * a.width) / LAYOUT_CELL));
    const y0 = Math.max(0, Math.floor((bx.y * a.height) / LAYOUT_CELL));
    const y1 = Math.min(rows - 1, Math.floor(((bx.y + bx.h) * a.height) / LAYOUT_CELL));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) mask[y * cols + x] = 1;
  }
  const ma = cellMeans(a, cols, rows);
  const mb = cellMeans(b, cols, rows);
  const moved = [];
  const masked = [];
  for (let c = 0; c < cols * rows; c++) {
    if (mask[c]) { masked.push(c); continue; }
    if ([0, 1, 2].some((k) => Math.abs(ma[c * 3 + k] - mb[c * 3 + k]) > LAYOUT_TOLERANCE)) moved.push(c);
  }
  const open = cols * rows - masked.length;
  return { share: open ? moved.length / open : 0, moved, masked, cols, rows };
}

/** The text boxes of a picture for masking, or throws: a layout comparison with the words left in would be noise. */
function boxesOf(file, language, textOf) {
  const lines = textOf(file, language);
  if (lines?.error) throw new Error(`compare: the text of ${path.basename(file)} cannot be masked: ${lines.error}`);
  return lines;
}

/**
 * The layout difference between a translated shot and its source-language reference, text masked in both and the
 * reference mirrored for a right-to-left language. `textOf(file, language)` reads the text boxes (default: Vision).
 */
export async function layoutAgainst(shotFile, refFile, { language, mirror = isRtl(language), textOf = readText } = {}) {
  const shot = await pixelsOf(shotFile);
  let ref = await pixelsOf(refFile);
  if (!shot || !ref) throw new Error(`compare: cannot read ${!shot ? shotFile : refFile}`);
  if (shot.width !== ref.width || shot.height !== ref.height) return { size: [`${ref.width}x${ref.height}`, `${shot.width}x${shot.height}`] };
  let refBoxes = boxesOf(refFile, undefined, textOf);
  if (mirror) { ref = mirrored(ref); refBoxes = mirroredBoxes(refBoxes); }
  const boxes = [...refBoxes, ...boxesOf(shotFile, language, textOf)];
  return { ...layoutDifference(ref, shot, boxes), shot, ref, mirror };
}

/** The pixel difference between a shot and its reference; `{ size }` when they are not one size. */
export async function pixelsAgainst(shotFile, refFile) {
  const shot = await pixelsOf(shotFile);
  const ref = await pixelsOf(refFile);
  if (!shot || !ref) throw new Error(`compare: cannot read ${!shot ? shotFile : refFile}`);
  if (shot.width !== ref.width || shot.height !== ref.height) return { size: [`${ref.width}x${ref.height}`, `${shot.width}x${shot.height}`] };
  return { ...pixelDifference(ref, shot), shot, ref };
}

/** The approvals record of a references folder. */
export function readApprovals(refs) {
  try { return JSON.parse(fs.readFileSync(path.join(refs, APPROVALS_FILE), 'utf8')); } catch { return { references: {}, accepted: {}, passed: {} }; }
}

export function writeApprovals(refs, approvals) {
  fs.mkdirSync(refs, { recursive: true });
  fs.writeFileSync(path.join(refs, APPROVALS_FILE), `${JSON.stringify(approvals, null, 2)}\n`);
}

/**
 * The thresholds a comparison judges by, from the config's `compare` block. Neither has a default: each must be set
 * above the noise measured between two captures of one build. Devices differ in their noise (a simulator can repeat a
 * picture exactly where an emulator does not), so `compare.targets[<target>]` may set either for one store target,
 * over the block's own `pixel` and `layout`.
 */
export function thresholdsOf(compare = {}, target) {
  const own = (target && compare.targets?.[target]) || {};
  const value = { pixel: own.pixel ?? compare.pixel, layout: own.layout ?? compare.layout };
  const missing = ['pixel', 'layout'].filter((k) => !(typeof value[k] === 'number' && value[k] >= 0 && value[k] < 1));
  if (missing.length) {
    throw new Error(`compare: the config's compare.${missing.join(' and compare.')} is not set${target ? ` for ${target}` : ''} (a share from 0 to 1). `
      + 'Measure the noise between two captures of one build with `zdymak compare --measure <first> <second>` and set each above it.');
  }
  return value;
}

/**
 * Record what a comparison passed, by content, in `approvals.json`'s `passed`: a shot within its threshold, or an
 * accepted one. An uploader reads the file to send only shots that passed or were approved (`isCleared`); a shot that
 * a later comparison sends to review loses its pass.
 */
export function recordPasses(refs, items, { now = new Date() } = {}) {
  const approvals = readApprovals(refs);
  approvals.passed ??= {};
  for (const i of items) {
    const sum = sha256(i.file);
    if (!i.review && !i.blocked) {
      approvals.passed[sum] = { target: i.target, scene: i.scene, language: i.language, kind: i.kind, measure: i.measure ?? null, threshold: i.threshold ?? null, at: now.toISOString() };
    } else delete approvals.passed[sum];
  }
  writeApprovals(refs, approvals);
  return approvals;
}

/** Whether a file's content is cleared to publish: an approved reference, an approved translated shot, or a pass. */
export function isCleared(approvals, sum) {
  return Boolean(approvals.passed?.[sum] || approvals.accepted?.[sum]
    || Object.values(approvals.references || {}).some((r) => r.sha256 === sum));
}

/**
 * Compare shots with their references. `files` are one store target's shots, scene = file name. Returns one item per
 * shot: `{ id, file, scene, target, language, source, kind, measure, threshold, review, blocked, reason }`. `kind` is
 * `same`, `accepted`, `new`, `size`, `pixel`, `layout` or `no-reference`; `review` marks what the owner must see;
 * `blocked` what cannot pass until something else is approved first.
 */
export async function compareShots(files, { target, refs, thresholds, language, sourceLocale = 'en', textOf = readText }) {
  if (!target) throw new Error('compare: --target names the store target the shots are for (one reference set per target)');
  const approvals = readApprovals(refs);
  const items = [];
  for (const file of files) {
    const scene = sceneOf(file);
    const lang = language || readFacts(file)?.language || sourceLocale;
    const source = baseOf(lang) === baseOf(sourceLocale);
    const ref = path.join(refs, target, `${scene}.png`);
    const id = `${target}--${lang}--${scene}`.replace(/[^\w.-]+/g, '_');
    const item = { id, file: path.resolve(file), scene, target, language: lang, source, reference: ref, review: false, blocked: false };
    const sum = sha256(file);
    if (!fs.existsSync(ref)) {
      if (source) Object.assign(item, { kind: 'new', review: true, reason: 'a new scene with no reference yet' });
      else Object.assign(item, { kind: 'no-reference', blocked: true, reason: `no ${sourceLocale} reference for ${scene} on ${target}: approve that first` });
    } else if (!source && approvals.accepted?.[sum]) {
      Object.assign(item, { kind: 'accepted', reason: `approved before (${approvals.accepted[sum].approved})` });
    } else {
      const d = source ? await pixelsAgainst(file, ref) : await layoutAgainst(file, ref, { language: lang, textOf });
      const kind = source ? 'pixel' : 'layout';
      if (d.size) Object.assign(item, { kind: 'size', review: true, reason: `the reference is ${d.size[0]}, the shot ${d.size[1]}` });
      else {
        const threshold = thresholds[kind];
        const over = d.share > threshold;
        Object.assign(item, {
          kind: over ? kind : 'same', measure: d.share, threshold, review: over, mirror: d.mirror,
          reason: `${(d.share * 100).toFixed(3)}% of the ${source ? 'pixels' : 'layout'} differs${d.mirror ? ' (against the reference mirrored)' : ''}, ${over ? 'over' : 'within'} ${(threshold * 100).toFixed(3)}%`,
        });
        item.diff = d;
      }
    }
    items.push(item);
  }
  return items;
}
