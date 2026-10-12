// The iOS 27 App Store assets: the iPhone Duo screenshot targets, the product page header / search results /
// universal creative graphics, and the header and search videos built by `zdymak reel`.
//   node --test scripts/store-assets.test.mjs        (or: npm run check:assets)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { IMAGE_TARGETS, VIDEO_TARGETS } from '../src/specs.mjs';
import { buildDeviceScreenshots, pickHero } from '../src/screenshots.mjs';
import { creativeLayout } from '../src/graphic.mjs';
import { inferFrame, frameFor, drawPhoneFrame, drawDuoFrame, drawDuoInnerFrame, duoAspect, screenAspectFor } from '../src/frames.mjs';
import { pngInfo, sizeViolations, videoViolations, inRange, validateImage } from '../src/validate.mjs';
import { resolveVideo, resolveReel } from '../src/destinations.mjs';
import { h264Level } from '../src/encode.mjs';
import { rgbPngBuffer } from '../src/png.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(root, 'bin', 'zdymak.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zdymak-assets-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** A busy capture (thousands of colours, so the blank-capture check passes) of the given size. */
function capture(file, w, h) {
  const c = createCanvas(w, h);
  const g = c.getContext('2d');
  for (let y = 0; y < h; y += 8) {
    for (let x = 0; x < w; x += 8) {
      g.fillStyle = `rgb(${(x * 7 + y) % 256},${(y * 3 + x * 5) % 256},${(x + y * 11) % 256})`;
      g.fillRect(x, y, 8, 8);
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, c.toBuffer('image/png'));
  return file;
}

/** A flat RGB PNG of the given size, written the way zdymak writes its output (no alpha). */
function flatRgb(file, w, h) {
  const c = createCanvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = '#336699';
  g.fillRect(0, 0, w, h);
  fs.writeFileSync(file, rgbPngBuffer(c));
  return file;
}

const brand = { ink: '#0b0b0a', title: '#F5F5F4', sub: '#BBF7D0', name: 'App', tagline: 'Short line. Second line.', fan: [] };
const device = (name, dir, scenes, screenshots) => ({
  name,
  scenes: scenes.map((id) => ({ id, image: path.join(dir, `${id}.png`), title: 'A headline.', sub: 'A subhead.' })),
  screenshots,
  videos: [],
});

// ─── iPhone Duo ─────────────────────────────────────────────────────────────────────────────────

const DUO = {
  'appstore-iphone-duo-outer': [1398, 2034],
  'appstore-iphone-duo-outer-landscape': [2034, 1398],
  'appstore-iphone-duo-inner': [2007, 2853],
  'appstore-iphone-duo-inner-landscape': [2853, 2007],
};

test('the four iPhone Duo targets carry Apple\'s four sizes, without alpha', () => {
  for (const [id, [w, h]] of Object.entries(DUO)) {
    const s = IMAGE_TARGETS[id];
    assert.ok(s, id);
    assert.deepEqual([s.w, s.h], [w, h], id);
    assert.equal(s.alpha, false, id);
    assert.equal(s.store, 'App Store', id);
  }
});

test('a Duo target infers a Duo frame, never the iPhone one, and the old inferences are unchanged', () => {
  assert.equal(inferFrame('appstore-iphone-duo-outer'), 'duo');
  assert.equal(inferFrame('appstore-iphone-duo-outer-landscape'), 'duo');
  assert.equal(inferFrame('appstore-iphone-duo-inner'), 'duo-inner');
  assert.equal(inferFrame('appstore-iphone-duo-inner-landscape'), 'duo-inner');
  assert.equal(inferFrame('appstore-iphone-6.9'), 'phone');
  assert.equal(inferFrame('appstore-ipad-13-landscape'), 'ipad');
  assert.equal(inferFrame('play-tablet'), 'android');
  assert.equal(inferFrame('appstore-header'), null);
  assert.equal(frameFor('duo'), drawDuoFrame);
  assert.equal(frameFor('duo-inner'), drawDuoInnerFrame);
});

test('the Duo frame has no Dynamic Island: the top of its screen is the capture, where the iPhone frame is black', () => {
  const white = createCanvas(466, 678);
  const wg = white.getContext('2d');
  wg.fillStyle = '#ffffff';
  wg.fillRect(0, 0, 466, 678);
  const probe = (draw) => {
    const c = createCanvas(800, 1200);
    const g = c.getContext('2d');
    g.fillStyle = '#ff0000'; // anything that is neither the screen nor the island
    g.fillRect(0, 0, 800, 1200);
    const { screen } = draw(g, white, 400, 600, 400);
    // Where drawPhoneFrame centres its island: horizontally centred, just under the top edge.
    const [r, gg, b] = g.getImageData(Math.round(screen.x + screen.w / 2), Math.round(screen.y + screen.w * 0.08), 1, 1).data;
    return [r, gg, b];
  };
  assert.deepEqual(probe(drawDuoFrame), [255, 255, 255]);
  assert.deepEqual(probe(drawDuoInnerFrame), [255, 255, 255]);
  const iphone = probe(drawPhoneFrame);
  assert.ok(iphone[0] < 20 && iphone[1] < 20 && iphone[2] < 20, `iPhone island expected dark, got ${iphone}`);
});

test('the Duo frame keeps its display\'s shape whatever capture it is given', () => {
  const tall = createCanvas(390, 845); // a 6.9"-shaped capture, much taller than the Duo's outer display
  const g = createCanvas(1000, 1600).getContext('2d');
  const { screen } = drawDuoFrame(g, tall, 500, 800, 400);
  assert.ok(Math.abs(screen.h / screen.w - 2034 / 1398) < 0.01);
  const wide = createCanvas(1600, 900);
  const inner = drawDuoInnerFrame(createCanvas(2000, 1600).getContext('2d'), wide, 1000, 800, 1200).screen;
  assert.ok(Math.abs(inner.w / inner.h - 2853 / 2007) < 0.01, 'a landscape capture turns the inner display');
  assert.equal(screenAspectFor('duo', tall), duoAspect('duo', false));
  assert.equal(screenAspectFor('phone', tall), 845 / 390);
});

test('every Duo target renders framed at its exact size as a no-alpha PNG', async () => {
  const portrait = path.join(tmp, 'duo-portrait');
  const landscape = path.join(tmp, 'duo-landscape');
  capture(path.join(portrait, 'a.png'), 466, 678); // the outer display's own shape
  capture(path.join(portrait, 'b.png'), 669, 951); // the inner display's own shape
  capture(path.join(landscape, 'a.png'), 678, 466);
  capture(path.join(landscape, 'b.png'), 951, 669);
  const out = path.join(tmp, 'out-duo');
  const shots = [
    ['appstore-iphone-duo-outer', portrait, 'a'], ['appstore-iphone-duo-inner', portrait, 'b'],
    ['appstore-iphone-duo-outer-landscape', landscape, 'a'], ['appstore-iphone-duo-inner-landscape', landscape, 'b'],
  ];
  for (const [target, dir, id] of shots) {
    const written = await buildDeviceScreenshots({ device: device(target, dir, [id], [{ target }]), brand, outDir: out });
    assert.equal(written.length, 1, target);
    assert.equal(written[0].style, 'framed', target);
    const info = pngInfo(written[0].file);
    assert.deepEqual([info.w, info.h], DUO[target], target);
    assert.equal(info.colourType, 2, `${target} must be RGB, no alpha`);
  }
});

// ─── Creative assets: header, search, universal ────────────────────────────────────────────────

test('the creative targets carry Apple\'s sizes and the safe areas from Apple\'s own template', () => {
  assert.deepEqual([IMAGE_TARGETS['appstore-header'].w, IMAGE_TARGETS['appstore-header'].h], [3840, 1646]);
  assert.deepEqual([IMAGE_TARGETS['appstore-search'].w, IMAGE_TARGETS['appstore-search'].h], [3840, 2560]);
  assert.deepEqual([IMAGE_TARGETS['appstore-universal'].w, IMAGE_TARGETS['appstore-universal'].h], [5244, 2950]);
  for (const id of ['appstore-header', 'appstore-search', 'appstore-universal']) {
    const s = IMAGE_TARGETS[id];
    assert.equal(s.alpha, false, id);
    assert.ok(s.graphic && s.creative, id);
    const [x, y, w, h] = s.safe;
    assert.ok(x >= 0 && y >= 0 && x + w <= s.w && y + h <= s.h, `${id}: safe area inside the canvas`);
    assert.equal(x + w / 2, s.w / 2, `${id}: safe area centred horizontally`);
  }
  // Header and search: centred both ways in the template. The universal's sits 334px above centre.
  for (const id of ['appstore-header', 'appstore-search']) {
    const [, y, , h] = IMAGE_TARGETS[id].safe;
    assert.ok(Math.abs(y + h / 2 - IMAGE_TARGETS[id].h / 2) <= 1, id);
  }
  const [, uy, , uh] = IMAGE_TARGETS['appstore-universal'].safe;
  assert.equal(2950 / 2 - (uy + uh / 2), 334);
});

test('the layout keeps the words inside the safe area, starts the hero inside it, and keeps the fan off the words', () => {
  for (const id of ['appstore-header', 'appstore-search', 'appstore-universal']) {
    const s = IMAGE_TARGETS[id];
    for (const [heroAspect, framed] of [[9 / 16, false], [2.17, true], [3 / 4, false]]) {
      const lay = creativeLayout({ W: s.w, H: s.h, safe: s.safe, heroAspect, framed });
      const { safe, text, hero, fan } = lay;
      const tag = `${id} hero ${heroAspect.toFixed(2)}`;
      assert.ok(text.x >= safe.x && text.y >= safe.y, tag);
      assert.ok(text.x + text.w <= safe.x + safe.w && text.y + text.h <= safe.y + safe.h, `${tag}: words inside the safe area`);
      assert.ok(hero.x >= text.x + text.w && hero.x < safe.x + safe.w, `${tag}: hero starts inside the safe area, right of the words`);
      assert.ok(hero.x + hero.w <= s.w && hero.y >= 0 && hero.y + hero.h <= s.h, `${tag}: hero inside the canvas`);
      assert.ok(Math.abs(hero.y + hero.h / 2 - (safe.y + safe.h / 2)) <= 1, `${tag}: hero centred on the safe area`);
      // A card is ~0.73 as wide as tall; three at 52% overlap, slightly rotated, reach ±(0.52 + 0.5 + 0.05)·0.73h.
      const reach = fan.h * 0.73 * 1.07;
      const clearOfWords = fan.cx + reach <= text.x || fan.cy - fan.h >= safe.y + safe.h - 1;
      assert.ok(clearOfWords, `${tag}: the fan stays outside the words`);
    }
  }
});

test('the creative graphics render at their sizes, no alpha, around the named hero', async () => {
  const dir = path.join(tmp, 'creative');
  capture(path.join(dir, 'phone.png'), 390, 845);
  capture(path.join(dir, 'table.png'), 1280, 720);
  const out = path.join(tmp, 'out-creative');
  const shots = [
    { target: 'appstore-header', hero: 'table' },
    { target: 'appstore-search' },
    { target: 'appstore-universal', hero: 'table' },
    { target: 'appstore-search', size: [1920, 1280], dir: 'search-small' }, // the minimum, in its own folder
  ];
  const written = await buildDeviceScreenshots({ device: device('creative', dir, ['phone', 'table'], shots), brand, outDir: out });
  const sizes = Object.fromEntries(written.map((w) => [path.relative(out, w.file), (({ w: a, h: b, colourType }) => [a, b, colourType])(pngInfo(w.file))]));
  assert.deepEqual(sizes, {
    'appstore-header.png': [3840, 1646, 2],
    'appstore-search.png': [3840, 2560, 2],
    'appstore-universal.png': [5244, 2950, 2],
    'search-small/appstore-search.png': [1920, 1280, 2],
  });
});

test('a creative target prefers a landscape hero; a named hero wins; a named hero that is missing is an error', () => {
  const dir = path.join(tmp, 'heroes');
  capture(path.join(dir, 'phone.png'), 120, 260);
  capture(path.join(dir, 'wide.png'), 320, 180);
  const scenes = ['phone', 'wide', 'gone'].map((id) => ({ id, image: path.join(dir, `${id}.png`) }));
  assert.equal(pickHero(scenes, { target: 'appstore-header' }, { preferLandscape: true }), scenes[1].image);
  assert.equal(pickHero(scenes, { target: 'play-feature-graphic' }), scenes[0].image, 'the feature graphic keeps the first capture');
  assert.equal(pickHero(scenes, { target: 'appstore-header', hero: 'phone' }, { preferLandscape: true }), scenes[0].image);
  assert.equal(pickHero(scenes, { target: 'appstore-header', hero: scenes[1].image }), scenes[1].image, 'a path works too');
  assert.throws(() => pickHero(scenes, { target: 'appstore-header', hero: 'gone' }), /scene "gone" has no capture/);
  assert.throws(() => pickHero(scenes, { target: 'appstore-header', hero: 'nope' }), /no scene has that id/);
});

// ─── Validation ─────────────────────────────────────────────────────────────────────────────────

test('the search image takes any exact 3:2 from 1920×1280 to 3840×2560, and nothing else', () => {
  const s = IMAGE_TARGETS['appstore-search'];
  for (const [w, h] of [[1920, 1280], [2880, 1920], [3000, 2000], [3840, 2560]]) {
    assert.ok(inRange(s.range, w, h), `${w}×${h}`);
    assert.deepEqual(sizeViolations(s, w, h, [w, h]), [], `${w}×${h}`);
  }
  for (const [w, h] of [[1800, 1200], [4200, 2800], [2000, 1333], [3840, 2561], [2560, 1440]]) {
    assert.ok(!inRange(s.range, w, h), `${w}×${h}`);
    assert.match(sizeViolations(s, w, h, [w, h]).join(), /outside what App Store accepts here: 3:2 from 1920×1280 to 3840×2560/, `${w}×${h}`);
  }
});

test('the header and universal take their one size; a size: override a store never offered is now refused', () => {
  assert.deepEqual(sizeViolations(IMAGE_TARGETS['appstore-header'], 3840, 1646, [3840, 1646]), []);
  assert.match(sizeViolations(IMAGE_TARGETS['appstore-header'], 3840, 1600, null).join(), /not one of the accepted sizes \(3840×1646\)/);
  assert.match(sizeViolations(IMAGE_TARGETS['appstore-header'], 3840, 1600, [3840, 1600]).join(), /not one of the accepted sizes/, 'an override cannot move the header');
  assert.match(sizeViolations(IMAGE_TARGETS['appstore-universal'], 5244, 2949, [5244, 2950]).join(), /expected 5244×2950/);
  // An override is compared with itself, so it used to pass whatever it was. A list now holds it.
  assert.match(sizeViolations(IMAGE_TARGETS['appstore-iphone-6.9'], 1000, 1000, [1000, 1000]).join(), /not one of the accepted sizes/);
  assert.deepEqual(sizeViolations(IMAGE_TARGETS['appstore-iphone-6.9'], 1290, 2796, [1290, 2796]), []);
  // A fixed size with no list still honours an explicit override, as before (a Mac reel at 2880×1800).
  assert.deepEqual(sizeViolations(VIDEO_TARGETS['premium-reel'], 2880, 1800, [2880, 1800]), []);
});

test('validateImage refuses alpha and a wrong size on the new targets, and accepts a right one', () => {
  const ok = flatRgb(path.join(tmp, 'search-ok.png'), 1920, 1280);
  validateImage({ file: ok, destination: IMAGE_TARGETS['appstore-search'], size: [1920, 1280] });
  const off = flatRgb(path.join(tmp, 'search-off.png'), 1920, 1300);
  assert.throws(() => validateImage({ file: off, destination: IMAGE_TARGETS['appstore-search'], size: [1920, 1300] }), /outside what App Store accepts/);
  const c = createCanvas(1398, 2034);
  c.getContext('2d').fillRect(0, 0, 10, 10); // RGBA straight from the canvas
  const alpha = path.join(tmp, 'duo-alpha.png');
  fs.writeFileSync(alpha, c.toBuffer('image/png'));
  assert.throws(() => validateImage({ file: alpha, destination: IMAGE_TARGETS['appstore-iphone-duo-outer'] }), /alpha channel/);
  const duoOk = flatRgb(path.join(tmp, 'duo-ok.png'), 1398, 2034);
  validateImage({ file: duoOk, destination: IMAGE_TARGETS['appstore-iphone-duo-outer'] });
  assert.throws(() => validateImage({ file: duoOk, destination: IMAGE_TARGETS['appstore-iphone-duo-inner'] }), /expected 2007×2853/);
});

// ─── Header and search videos ──────────────────────────────────────────────────────────────────

const clip = (w, h, duration, fps = 30) => ({ w, h, duration, fps, bytes: 1e6 });

test('the header video: 3840×1646, 30 or 60 fps, 5 to 30 seconds', () => {
  const d = VIDEO_TARGETS['appstore-header-video'];
  assert.deepEqual(videoViolations(d, clip(3840, 1646, 12)), []);
  assert.deepEqual(videoViolations(d, clip(3840, 1646, 5)), []);
  assert.deepEqual(videoViolations(d, clip(3840, 1646, 30, 60)), []);
  assert.deepEqual(videoViolations(d, clip(3840, 1646, 12, 29.97)), [], '29.97 is what "30 fps" means in practice');
  assert.match(videoViolations(d, clip(3840, 1646, 4.5)).join(), /under App Store's 5s minimum/);
  assert.match(videoViolations(d, clip(3840, 1646, 31)).join(), /exceeds App Store's 30s maximum/);
  assert.match(videoViolations(d, clip(3840, 1646, 12, 25)).join(), /25\.00 fps; App Store takes 30 or 60 fps/);
  assert.match(videoViolations(d, clip(3840, 1600, 12), [3840, 1600]).join(), /not one of the accepted sizes/, 'an override cannot move the header');
});

test('the search video: any 3:2 in range, default 2880×1920, always muted', () => {
  const d = VIDEO_TARGETS['appstore-search-video'];
  assert.deepEqual([d.w, d.h], [2880, 1920]);
  assert.equal(d.muted, 'always');
  for (const [w, h] of [[1920, 1280], [2880, 1920], [3840, 2560]]) assert.deepEqual(videoViolations(d, clip(w, h, 8), [w, h]), [], `${w}×${h}`);
  assert.match(videoViolations(d, clip(1280, 720, 8), [1280, 720]).join(), /outside what App Store accepts/);
});

test('the header and search videos are reel-only: video/build refuse them and say where to go', () => {
  for (const id of ['appstore-header-video', 'appstore-search-video']) {
    assert.throws(() => resolveVideo({ target: id }), /built by `zdymak reel`/);
  }
});

test('a reel answers to its destination by key or by name, and takes its defaults from it', () => {
  const byKey = resolveReel({ destination: 'appstore-header-video', segments: [] }, 'vinto-header');
  assert.equal(byKey.destId, 'appstore-header-video');
  assert.deepEqual([byKey.spec.w, byKey.spec.h, byKey.spec.fps], [3840, 1646, 30]);
  assert.equal(byKey.theme.frame, false, 'no iPhone bezel round a landscape clip in a 21:9 strip');
  const own = resolveReel({ destination: 'appstore-header-video', theme: { frame: 'phone', bgTop: '#000000' } }, 'x');
  assert.equal(own.theme.frame, 'phone', 'an explicit frame still wins');
  const byName = resolveReel({ size: [886, 1920], level: '4.0' }, 'appstore-preview');
  assert.equal(byName.destId, 'appstore-preview');
  assert.deepEqual([byName.spec.w, byName.spec.level], [886, '4.0']);
  assert.equal(byName.theme, undefined, 'an App Preview reel keeps its own theme untouched');
  const free = resolveReel({}, 'my-cut');
  assert.equal(free.destination, null);
  assert.deepEqual([free.spec.w, free.spec.h, free.spec.level], [1080, 1920, '4.1']);
  assert.throws(() => resolveReel({ destination: 'appstore-hedaer-video' }, 'x'), /unknown destination "appstore-hedaer-video"/);
});

test('the encoder declares a level the frame actually fits (3840 wide is not level 4.1)', () => {
  assert.equal(h264Level(3840, 1646, 30, '4.1'), '5.1');
  assert.equal(h264Level(3840, 1646, 60, '4.1'), '5.2');
  assert.equal(h264Level(2880, 1920, 30, '4.1'), '5.1');
  assert.equal(h264Level(886, 1920, 30, '4.0'), '4.0', 'the App Preview keeps the level Apple names');
  assert.equal(h264Level(1080, 1920, 30, '4.1'), '4.1');
});

// ─── Through the CLI ───────────────────────────────────────────────────────────────────────────

test('specs prints every new target with its size', () => {
  const r = spawnSync(process.execPath, [bin, 'specs'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  for (const id of [...Object.keys(DUO), 'appstore-header', 'appstore-search', 'appstore-universal']) assert.match(r.stdout, new RegExp(`${id} +\\d`), id);
  assert.match(r.stdout, /appstore-search +3840×2560 \(any 3:2 from 1920×1280 to 3840×2560\)/);
  assert.match(r.stdout, /appstore-header-video +3840×1646 @30\|60 .* 5–30s +\[zdymak reel\]/);
  assert.match(r.stdout, /appstore-search-video +2880×1920 \(any 3:2/);
});

const hasFfmpeg = spawnSync(process.env.FFMPEG || 'ffmpeg', ['-version']).status === 0;

test('a reel is measured against its destination after the encode: refused when short, written under --force', { skip: !hasFfmpeg && 'no ffmpeg' }, () => {
  // Deliberately tiny: 0.6 s at the slot's smallest size, from a generated clip (a still would go through
  // zoompan, which costs more). A passing 5 s reel at 1920×1280 is ~30 s of CPU on a laptop — too much
  // for every verify — and the rules it would exercise are the pure ones tested above. What only a real
  // run can show is the wiring: the reel command measures what it wrote, against the right destination.
  const dir = path.join(tmp, 'reel');
  fs.mkdirSync(dir, { recursive: true });
  const made = spawnSync(process.env.FFMPEG || 'ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=192x128:rate=30',
    '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', path.join(dir, 'clip.mp4')]);
  assert.equal(made.status, 0);
  const config = path.join(dir, 'zdymak.config.mjs');
  fs.writeFileSync(config, `export default { out: './out', reel: { name: 'search', destination: 'appstore-search-video', size: [1920, 1280],
    transition: 'cut', theme: { bleed: true }, segments: [{ clip: './clip.mp4', dur: 0.6 }] } };\n`);
  const run = (...extra) => spawnSync(process.execPath, [bin, 'reel', '--config', config, ...extra], { encoding: 'utf8', cwd: dir });
  const short = run();
  assert.equal(short.status, 1, short.stdout + short.stderr);
  assert.match(short.stdout, /search \(appstore-search-video\): 1 segment\(s\) → 1920×1280 @30/);
  assert.match(short.stderr, /under App Store's 5s minimum/);
  const forced = run('--force');
  assert.equal(forced.status, 0, forced.stdout + forced.stderr);
  assert.match(forced.stderr, /--force: written anyway/);
  assert.doesNotMatch(forced.stderr, /plays SILENT/, 'a creative video works silently by design, so no nag about music');
});
