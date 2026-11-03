// The references, the pixel and layout comparison, the review page and the approve/reject answers (src/compare.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { rgbPngBuffer } from '../src/png.mjs';
import {
  compareShots, layoutDifference, mirrored, mirroredBoxes, pixelDifference, readApprovals, thresholdsOf,
} from '../src/compare.mjs';
import { decide, writeReview } from '../src/review.mjs';
import { measurePairs } from '../src/noise.mjs';
import { pixelsOf } from '../src/checker.mjs';

const W = 320;
const H = 480;
const TITLE = { x: 0.1, y: 0.05, w: 0.8, h: 0.08 };
const THRESHOLDS = { pixel: 0.001, layout: 0.01 };

/** A screen: a ground, a panel on one side, a title line of `text` and a button. `rtl` puts the panel on the right. */
function screen(file, { rtl = false, text = 'Daily puzzle', panel = '#2a6f97', ground = '#f4efe6', button = 0 } = {}) {
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = ground; g.fillRect(0, 0, W, H);
  g.fillStyle = panel; g.fillRect(rtl ? W - 140 : 20, 120, 120, 200);
  g.fillStyle = '#c1121f'; g.fillRect(100 + button, 380, 120, 48);
  g.fillStyle = '#111'; g.font = '24px sans-serif'; g.fillText(text, rtl ? 120 : 36, 52);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rgbPngBuffer(c));
  return file;
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'zdymak-compare-'));
/** The text reader, faked: every shot has its title line where the screen draws it. */
const textOf = () => [{ ...TITLE, text: 'title', conf: 1 }];
const rtlTextOf = () => mirroredBoxes([{ ...TITLE, text: 'title', conf: 1 }]);

test('the pixel difference is nothing for one picture and the changed share for another', async () => {
  const d = tmp();
  const a = await pixelsOf(screen(path.join(d, 'a.png')));
  const b = await pixelsOf(screen(path.join(d, 'b.png'), { button: 8 }));
  assert.equal(pixelDifference(a, a).share, 0);
  const diff = pixelDifference(a, b);
  assert.ok(diff.share > 0 && diff.share < 0.02, `${diff.share}`);
  assert.equal(diff.changed.reduce((n, x) => n + x, 0), Math.round(diff.share * W * H));
});

test('a picture mirrored twice is itself, and a text box mirrors to the other side', async () => {
  const d = tmp();
  const a = await pixelsOf(screen(path.join(d, 'a.png')));
  assert.deepEqual(mirrored(mirrored(a)).data, a.data);
  assert.deepEqual(mirroredBoxes([{ x: 0.1, y: 0, w: 0.3, h: 0.1 }]).map((b) => +b.x.toFixed(6)), [0.6]);
});

test('the layout leaves masked text out and finds a panel that moved', async () => {
  const d = tmp();
  const en = await pixelsOf(screen(path.join(d, 'en.png')));
  const de = await pixelsOf(screen(path.join(d, 'de.png'), { text: 'Das Tagesrätsel' }));
  assert.ok(layoutDifference(en, de).share > 0, 'unmasked, the longer title moves cells');
  assert.equal(layoutDifference(en, de, [TITLE]).share, 0, 'masked, the text is not layout');
  const moved = await pixelsOf(screen(path.join(d, 'moved.png'), { rtl: true }));
  assert.ok(layoutDifference(en, moved, [TITLE]).share > THRESHOLDS.layout);
});

test('no threshold, no verdict: compare asks for the measured noise', () => {
  assert.throws(() => thresholdsOf({}), /compare\.pixel and compare\.layout.*--measure/);
  assert.throws(() => thresholdsOf({ pixel: 0.01 }), /compare\.layout/);
  assert.deepEqual(thresholdsOf({ pixel: 0, layout: 0.02 }), { pixel: 0, layout: 0.02 });
});

test('a new English scene goes to review, an approved one is the reference, a changed one waits again, a rejected one changes nothing', async () => {
  const d = tmp();
  const refs = path.join(d, 'references');
  const review = path.join(d, 'review');
  const run = (dir) => compareShots(fs.readdirSync(dir).map((f) => path.join(dir, f)), { target: 'tablet', refs, thresholds: THRESHOLDS, language: 'en', textOf });

  screen(path.join(d, 'en1', 'home.png'));
  let items = await run(path.join(d, 'en1'));
  assert.deepEqual(items.map((i) => [i.kind, i.review]), [['new', true]]);
  const page = await writeReview(items, review, { refs });
  const html = fs.readFileSync(page, 'utf8');
  assert.match(html, /data:image\/jpeg;base64,/);
  assert.match(html, /zdymak/);
  assert.ok(fs.existsSync(path.join(review, 'tablet--en--home.new.png')));

  decide(review, ['tablet--en--home'], 'approve');
  assert.ok(fs.existsSync(path.join(refs, 'tablet', 'home.png')));
  assert.ok(readApprovals(refs).references['tablet/home'].sha256);

  screen(path.join(d, 'en2', 'home.png'));
  items = await run(path.join(d, 'en2'));
  assert.deepEqual(items.map((i) => [i.kind, i.review, i.measure]), [['same', false, 0]]);

  screen(path.join(d, 'en3', 'home.png'), { button: 24 });
  items = await run(path.join(d, 'en3'));
  assert.equal(items[0].kind, 'pixel');
  assert.ok(items[0].review);
  fs.rmSync(review, { recursive: true });
  await writeReview(items, review, { refs });
  for (const f of ['new', 'old', 'diff']) assert.ok(fs.existsSync(path.join(review, `tablet--en--home.${f}.png`)), f);
  const before = fs.readFileSync(path.join(refs, 'tablet', 'home.png'));
  decide(review, ['tablet--en--home'], 'reject');
  assert.deepEqual(fs.readFileSync(path.join(refs, 'tablet', 'home.png')), before);
  assert.equal(JSON.parse(fs.readFileSync(path.join(review, 'decisions.json'), 'utf8'))['tablet--en--home'].verdict, 'reject');
});

test('Arabic is held against the English mirrored, with its text masked; an approved translation is not asked twice', async () => {
  const d = tmp();
  const refs = path.join(d, 'references');
  fs.mkdirSync(path.join(refs, 'tablet'), { recursive: true });
  screen(path.join(refs, 'tablet', 'home.png'));
  const textBoth = (file) => (file.includes(`${path.sep}ar`) ? rtlTextOf() : textOf());
  const opts = { target: 'tablet', refs, thresholds: THRESHOLDS, textOf: textBoth };

  const good = screen(path.join(d, 'ar', 'home.png'), { rtl: true, text: 'لغز اليوم' });
  let [item] = await compareShots([good], { ...opts, language: 'ar' });
  assert.equal(item.kind, 'same', item.reason);
  assert.equal(item.mirror, true);

  const unmirrored = screen(path.join(d, 'ar-bad', 'home.png'), { text: 'لغز اليوم' });
  [item] = await compareShots([unmirrored], { ...opts, language: 'ar', textOf: textOf });
  assert.equal(item.kind, 'layout');
  assert.ok(item.review);

  const review = path.join(d, 'review');
  await writeReview([item], review, { refs });
  decide(review, [], 'approve', { all: true });
  [item] = await compareShots([unmirrored], { ...opts, language: 'ar', textOf: textOf });
  assert.equal(item.kind, 'accepted');
  assert.ok(fs.readFileSync(path.join(refs, 'tablet', 'home.png')), 'the English reference stays');
});

test('a translated scene with no English reference is refused until the English one is approved', async () => {
  const d = tmp();
  const shot = screen(path.join(d, 'fr', 'result.png'));
  const [item] = await compareShots([shot], { target: 'phone', refs: path.join(d, 'references'), thresholds: THRESHOLDS, language: 'fr', textOf });
  assert.deepEqual([item.kind, item.review, item.blocked], ['no-reference', false, true]);
});

test('--measure gives the pixel and layout noise of each scene two captures share', async () => {
  const d = tmp();
  screen(path.join(d, 'one', 'home.png'));
  screen(path.join(d, 'one', 'only-here.png'));
  screen(path.join(d, 'two', 'home.png'), { button: 2 });
  const rows = await measurePairs(path.join(d, 'one'), path.join(d, 'two'), { textOf });
  assert.equal(rows.length, 1);
  assert.ok(rows[0].pixel > 0);
  assert.ok(rows[0].layout >= 0);
});
