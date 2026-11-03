/** The noise between two captures of one build, the measure the compare thresholds are set above (compare.mjs). */
import fs from 'node:fs';
import path from 'node:path';
import { layoutAgainst, pixelsAgainst } from './compare.mjs';
import { readText } from './ocr.mjs';

const sceneOf = (file) => path.basename(file, path.extname(file));

/**
 * The noise between two captures: for each scene in both (files or folders, matched by file name), the pixel and the
 * layout difference, text masked, the first mirrored when `mirror`. One row per scene.
 */
export async function measurePairs(first, second, { language, mirror = false, textOf = readText } = {}) {
  const rows = [];
  for (const [a, b] of pairsOf(first, second)) {
    const px = await pixelsAgainst(b, a);
    const lay = await layoutAgainst(b, a, { language, mirror, textOf });
    rows.push({ scene: sceneOf(a), first: a, second: b, pixel: px.size ? null : px.share, layout: lay.size ? null : lay.share, size: px.size || null });
  }
  return rows;
}

function pairsOf(first, second) {
  const pngs = (p) => (fs.statSync(p).isDirectory()
    ? fs.readdirSync(p).filter((f) => f.toLowerCase().endsWith('.png')).sort().map((f) => path.join(p, f))
    : [p]);
  if (!fs.statSync(first).isDirectory()) return [[first, second]];
  const other = new Map(pngs(second).map((f) => [path.basename(f), f]));
  return pngs(first).filter((f) => other.has(path.basename(f))).map((f) => [f, other.get(path.basename(f))]);
}
