// The iPhone Duo half open, drawn in perspective (src/fold3d.mjs): a scene's `fold`, the projection, where the
// device lands on the frame, the screen's pixels, the metal edges, and the flat frame left as it was.
//   node --test scripts/fold3d.test.mjs        (or: npm run check:fold3d)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { buildDeviceScreenshots } from '../src/screenshots.mjs';
import { premiumStill } from '../src/premium.mjs';
import { loadConfig } from '../src/config.mjs';
import { duoAspect } from '../src/frames.mjs';
import { pngInfo } from '../src/validate.mjs';
import { FOLD_DEFAULTS, resolveFold, foldGeometry, fitFold, foldHomography, pointOn, drawFoldedDuo } from '../src/fold3d.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zdymak-fold3d-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// A small capture of the inner display, upright (half open like a laptop) or wide (like a book), in the
// display's own shape. Its colour changes smoothly with position, so a pixel can be checked against the point
// it came from; a fine check pattern in one corner gives it the thousands of colours the blank-capture check
// wants to see.
const SHORT = 201;
function captureCanvas(wide) {
  const long = Math.round(SHORT * duoAspect('duo-inner', false));
  const [w, h] = wide ? [long, SHORT] : [SHORT, long];
  const c = createCanvas(w, h);
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      img.data[o] = Math.round(30 + (180 * x) / w);
      img.data[o + 1] = Math.round(40 + (170 * y) / h);
      img.data[o + 2] = Math.round(200 - (120 * (x + y)) / (w + h));
      img.data[o + 3] = 255;
    }
  }
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 48; x++) {
      const o = (y * w + x) * 4;
      img.data[o] = (x * 37 + y * 11) % 256;
      img.data[o + 1] = (x * 5 + y * 41) % 256;
      img.data[o + 2] = (x * 23 + y * 3) % 256;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}
const colourAt = (canvas, x, y) => [...canvas.getContext('2d').getImageData(Math.floor(x), Math.floor(y), 1, 1).data.slice(0, 3)];
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

function writeCapture(name, wide) {
  const file = path.join(tmp, 'captures', `${name}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, captureCanvas(wide).toBuffer('image/png'));
  return file;
}
const laptopPng = writeCapture('laptop', false);
const bookPng = writeCapture('book', true);

const brand = { ink: '#0b0b0a', title: '#F5F5F4', sub: '#BBF7D0' };
// A ground that is the same in every row (no glow, no vignette), so anything that is not ground can be found.
const FLAT_GROUND = { bgTop: '#20303a', bgBottom: '#20303a', glowAlpha: 0, vignette: 0, statusBar: false };

async function shoot(name, target, scenes, shot = {}) {
  const outDir = path.join(tmp, 'out', name);
  const written = await buildDeviceScreenshots({
    device: { name, scenes, screenshots: [{ target, ...shot }], videos: [] },
    brand, theme: FLAT_GROUND, outDir,
  });
  return written;
}
async function pixels(file) {
  const img = await loadImage(fs.readFileSync(file));
  const c = createCanvas(img.width, img.height);
  c.getContext('2d').drawImage(img, 0, 0);
  return { w: img.width, h: img.height, d: c.getContext('2d').getImageData(0, 0, img.width, img.height).data };
}

// ─── The scene key ──────────────────────────────────────────────────────────────────────────────

test('fold: a posture by name, the --posture names too, or an object that overrides the defaults', () => {
  assert.equal(resolveFold(undefined), null);
  assert.equal(resolveFold(false), null);
  assert.deepEqual(resolveFold('laptop'), { posture: 'laptop', ...FOLD_DEFAULTS.laptop });
  assert.equal(resolveFold('half-book').posture, 'book');
  assert.equal(resolveFold('Half-Laptop').posture, 'laptop');
  // Today's defaults: the camera 24 degrees up for the laptop and 12 for the book, the book drawn gentler than captured.
  assert.equal(resolveFold('laptop').elev, 24);
  assert.equal(resolveFold('book').elev, 12);
  assert.equal(resolveFold('laptop').hinge, 110);
  assert.equal(resolveFold('book').hinge, 136);
  const tuned = resolveFold({ posture: 'laptop', elev: 34, hinge: 115, yaw: -8, dist: 4, crease: 0 });
  assert.deepEqual(tuned, { posture: 'laptop', hinge: 115, elev: 34, yaw: -8, dist: 4, crease: 0 });
});

test('fold refuses a posture it does not draw, an option it does not have, and a number out of range', () => {
  assert.throws(() => resolveFold('tent', 'scene "x"'), /scene "x": fold posture must be 'laptop' or 'book'/);
  assert.throws(() => resolveFold({ posture: 'book', tilt: 4 }), /no option "tilt"/);
  assert.throws(() => resolveFold({ posture: 'book', elev: 95 }), /fold\.elev must be a number from 0 to 80/);
  assert.throws(() => resolveFold({ posture: 'book', hinge: 'wide' }), /fold\.hinge/);
  assert.throws(() => resolveFold(['laptop']), /fold must be/);
});

test('a misspelt fold fails at config load, naming the scene', async () => {
  const file = path.join(tmp, 'bad.config.mjs');
  fs.writeFileSync(file, `export default { devices: { duo: { scenes: [{ id: 'a', image: '${laptopPng}', fold: 'lapotp' }], screenshots: ['appstore-iphone-duo-inner'] } } };`);
  await assert.rejects(loadConfig(file), /Config error: scene\[0\]: fold posture/);
  const ok = path.join(tmp, 'ok.config.mjs');
  fs.writeFileSync(ok, `export default { devices: { duo: { scenes: [{ id: 'a', image: '${laptopPng}', fold: { posture: 'laptop', elev: 30 } }], screenshots: ['appstore-iphone-duo-inner'] } } };`);
  const cfg = await loadConfig(ok);
  assert.deepEqual(cfg.devices[0].scenes[0].fold, { posture: 'laptop', elev: 30 }, 'the fold reaches the renderer as written');
});

// ─── The projection ─────────────────────────────────────────────────────────────────────────────

for (const posture of ['laptop', 'book']) {
  test(`${posture}: each half's homography takes a sheet point to where the camera sees it`, () => {
    const [Sw, Sh] = posture === 'book' ? [286, 201] : [201, 286];
    const g = foldGeometry(Sw, Sh, resolveFold({ posture, yaw: 9 }));
    const fit = fitFold(g, { cx: 500, cy: 700, boxW: 860, boxH: 1000 });
    // The pinhole camera written out on its own: x right and y down on the image plane, scaled and centred.
    const camera = (p) => {
      const q = p.map((c, i) => c - g.cam[i]);
      const along = (a) => q[0] * a[0] + q[1] * a[1] + q[2] * a[2];
      const z = along(g.fwd);
      return [fit.s * (along(g.right) / z) + fit.tx, fit.s * (-along(g.up) / z) + fit.ty];
    };
    const { B, F } = g;
    for (const h of g.halves) {
      const Hm = foldHomography(g, fit, h);
      const pts = [[0, 0], [Sw, 0], [0, Sh], [Sw, Sh], [-B, -B], [Sw + B, Sh + B], [Sw / 2, Sh / 2], [Sw / 4, Sh * 0.75],
        g.foldAxis === 'v' ? [Sw * 0.3, F] : [F, Sh * 0.3]].filter(([u, v]) => h.inside(u, v));
      assert.ok(pts.length >= 4, `${h.name}: points to check`);
      for (const [u, v] of pts) {
        const w = Hm[6] * u + Hm[7] * v + Hm[8];
        const got = [(Hm[0] * u + Hm[1] * v + Hm[2]) / w, (Hm[3] * u + Hm[4] * v + Hm[5]) / w];
        const want = camera(pointOn(h, u, v));
        assert.ok(Math.abs(got[0] - want[0]) < 1e-6 && Math.abs(got[1] - want[1]) < 1e-6, `${h.name} (${u}, ${v}): ${got} vs ${want}`);
      }
    }
    // Both halves see the fold in the same place, so the two faces meet.
    const end = g.foldAxis === 'v' ? [Sw * 0.4, F] : [F, Sh * 0.4];
    const [a, b] = g.halves.map((h) => camera(pointOn(h, ...end)));
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6, 'the halves share the fold');
  });

  test(`${posture}: the halves meet at the hinge angle drawn`, () => {
    for (const hinge of [90, FOLD_DEFAULTS[posture].hinge, 160]) {
      const g = foldGeometry(200, 200, resolveFold({ posture, hinge }));
      const [h0, h1] = g.halves;
      // Away from the fold along each half: down the sheet for the laptop's base, up it for its lid; out to each
      // side for the book.
      const away = posture === 'laptop' ? [h0.V, h1.V.map((c) => -c)] : [h0.U.map((c) => -c), h1.U];
      const cos = away[0].reduce((s, c, i) => s + c * away[1][i], 0);
      assert.ok(Math.abs((Math.acos(cos) * 180) / Math.PI - hinge) < 1e-9, `${posture} at ${hinge}`);
    }
  });
}

// ─── The picture ────────────────────────────────────────────────────────────────────────────────

test('the screen is the capture: the middle of each half is the colour the capture has there', () => {
  for (const [posture, wide] of [['laptop', false], ['book', true]]) {
    const cap = captureCanvas(wide);
    const [W, H] = wide ? [2853, 2007] : [2007, 2853];
    const frame = createCanvas(W, H);
    const ctx = frame.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);
    const drawn = drawFoldedDuo(ctx, cap, W / 2, H * 0.57, W * 0.6, { fold: posture, maxW: W });
    const { w, h } = drawn.sheet;
    const middles = posture === 'laptop'
      ? { lid: [w / 2, h / 4], base: [w / 2, (h * 3) / 4] }
      : { left: [w / 4, h / 2], right: [(w * 3) / 4, h / 2] };
    assert.deepEqual(Object.keys(middles).sort(), [...drawn.halves].sort());
    for (const [half, [u, v]] of Object.entries(middles)) {
      const [x, y] = drawn.project(half, u, v);
      const got = colourAt(frame, x, y);
      const want = colourAt(cap, u, v);
      assert.ok(near(got, want, 3), `${posture} ${half}: drawn ${got}, captured ${want}`);
    }
  }
});

test('the laptop\'s metal edges shade evenly along their length: no stripes, no seams', () => {
  // Three bugs the prototype paid for, each a stripe along an edge. A gradient whose axis ran through each edge
  // piece's middle tilted with the perspective and stepped from piece to piece; one long piece per side let the
  // shade drift along its length; and pieces that only met edge to edge let the ground through between them. So
  // along a straight edge, at a fixed depth into it, the metal must be one even shade: no step between
  // neighbours and no drift end to end. Each bug, put back, fails this (checked when it was written).
  const cap = captureCanvas(false);
  const [W, H] = [2007, 2853];
  for (const yaw of [0, 25]) {
    const frame = createCanvas(W, H);
    const ctx = frame.getContext('2d');
    ctx.fillStyle = '#20303a';
    ctx.fillRect(0, 0, W, H);
    const drawn = drawFoldedDuo(ctx, cap, W / 2, H * 0.57, W * 0.6, { fold: { posture: 'laptop', yaw }, maxW: W });
    const px = ctx.getImageData(0, 0, W, H).data;
    const at = (x, y) => {
      const x0 = Math.floor(x - 0.5);
      const y0 = Math.floor(y - 0.5);
      const fx = x - 0.5 - x0;
      const fy = y - 0.5 - y0;
      return [0, 1, 2].map((c) => {
        const p = (xx, yy) => px[(yy * W + xx) * 4 + c];
        return (p(x0, y0) * (1 - fx) + p(x0 + 1, y0) * fx) * (1 - fy) + (p(x0, y0 + 1) * (1 - fx) + p(x0 + 1, y0 + 1) * fx) * fy;
      });
    };
    const { w, h, bezel, corner, thickness, fold } = drawn.sheet;
    const [, top] = drawn.project('base', w / 2, h + bezel, 0);
    const [, bottom] = drawn.project('base', w / 2, h + bezel, thickness);
    assert.ok(bottom - top >= 8, `yaw ${yaw}: the front edge is ${(bottom - top).toFixed(1)} px deep, enough to look at`);
    // The front edge, across its straight part; seen from the right, the base's right side too.
    const edges = { front: [[corner - bezel + 4, h + bezel], [w + bezel - corner - 4, h + bezel]] };
    if (yaw) edges.side = [[w + bezel, fold + 4], [w + bezel, h + bezel - corner - 4]];
    for (const [edge, [[ua, va], [ub, vb]]] of Object.entries(edges)) {
      for (const depth of [0.15, 0.5, 0.85]) {
        const a = drawn.project('base', ua, va, thickness * depth);
        const b = drawn.project('base', ub, vb, thickness * depth);
        const n = Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]));
        const samples = [];
        for (let i = 0; i <= n; i++) samples.push(at(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n));
        const where = `yaw ${yaw}, ${edge} edge, ${depth} deep`;
        let step = 0;
        for (let i = 1; i < samples.length; i++) step = Math.max(step, ...samples[i].map((v, c) => Math.abs(v - samples[i - 1][c])));
        assert.ok(step <= 3, `${where}: steps by ${step.toFixed(1)} levels between neighbours`);
        const inner = samples.slice(Math.ceil(n * 0.03), Math.floor(n * 0.97));
        const spread = Math.max(...[0, 1, 2].map((c) => Math.max(...inner.map((s) => s[c])) - Math.min(...inner.map((s) => s[c]))));
        assert.ok(spread <= 3, `${where}: drifts by ${spread.toFixed(1)} levels end to end`);
        assert.ok(inner.every((s) => s[0] > 0x40), `${where}: the ground shows through`);
      }
    }
  }
});

test('the shot is the target\'s size, a fold scene beside a flat one in one set', async () => {
  const written = await shoot('sizes-portrait', 'appstore-iphone-duo-inner', [
    { id: 'flat', image: laptopPng },
    { id: 'laptop', image: laptopPng, fold: 'laptop' },
  ]);
  assert.equal(written.length, 2);
  for (const { file } of written) assert.deepEqual([pngInfo(file).w, pngInfo(file).h], [2007, 2853], file);
  const wide = await shoot('sizes-landscape', 'appstore-iphone-duo-inner-landscape', [{ id: 'book', image: bookPng, fold: { posture: 'book', hinge: 140 } }]);
  assert.deepEqual([pngInfo(wide[0].file).w, pngInfo(wide[0].file).h], [2853, 2007]);
});

test('the device stays inside the frame, below the caption, in the band the flat Duo takes', async () => {
  for (const [posture, png, target] of [['laptop', laptopPng, 'appstore-iphone-duo-inner'], ['book', bookPng, 'appstore-iphone-duo-inner-landscape']]) {
    const caption = { title: 'A headline that is long.', sub: 'A subhead long enough to wrap onto a second line on this frame.' };
    const [withCaption, without, flat] = await Promise.all([
      shoot(`${posture}-captioned`, target, [{ id: 'a', image: png, fold: posture, ...caption }]),
      shoot(`${posture}-bare`, target, [{ id: 'a', image: png, fold: posture }]),
      shoot(`${posture}-flat`, target, [{ id: 'a', image: png }]),
    ]).then((sets) => Promise.all(sets.map((s) => pixels(s[0].file))));
    const { w: W, h: H } = without;
    // Rows that are not ground: the ground is the same in every row (FLAT_GROUND, and the book's shade is a column).
    const rowsOf = (img, differs) => {
      const rows = [];
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (differs(img, x, y)) {
            rows.push(y);
            break;
          }
        }
      }
      return rows;
    };
    const notGround = (img, x, y) => {
      const o = (y * W + x) * 4;
      const g = x * 4;
      return Math.abs(img.d[o] - img.d[g]) > 2 || Math.abs(img.d[o + 1] - img.d[g + 1]) > 2 || Math.abs(img.d[o + 2] - img.d[g + 2]) > 2;
    };
    const device = rowsOf(without, notGround);
    const flatBody = rowsOf(flat, notGround);
    // The caption is what the captioned shot has and the bare one does not.
    const captionRows = rowsOf(withCaption, (img, x, y) => {
      const o = (y * W + x) * 4;
      return Math.abs(img.d[o] - without.d[o]) > 2 || Math.abs(img.d[o + 1] - without.d[o + 1]) > 2 || Math.abs(img.d[o + 2] - without.d[o + 2]) > 2;
    });
    assert.ok(captionRows.length > 0, `${posture}: the caption is drawn`);
    const deviceTop = device[0];
    const deviceBottom = device[device.length - 1];
    assert.ok(Math.max(...captionRows) < deviceTop, `${posture}: the caption (to row ${Math.max(...captionRows)}) is clear of the device (from row ${deviceTop})`);
    assert.ok(deviceTop > 0 && deviceBottom < H - 1, `${posture}: the device is inside the frame top to bottom (${deviceTop}..${deviceBottom})`);
    assert.ok(deviceTop >= flatBody[0] - 2, `${posture}: no higher than the flat Duo's body (${deviceTop} vs ${flatBody[0]})`);
    for (const x of [0, W - 1]) {
      for (let y = 0; y < H; y++) assert.ok(!notGround(without, x, y), `${posture}: the device reaches the frame's side at (${x}, ${y})`);
    }
  }
});

// ─── Everything else stays flat ─────────────────────────────────────────────────────────────────

test('a scene without fold keeps the flat Duo frame, pixel for pixel', async () => {
  const [shot] = await shoot('flat-same', 'appstore-iphone-duo-inner', [{ id: 'a', image: laptopPng, title: 'Flat.', sub: 'As before.' }]);
  const img = await loadImage(laptopPng);
  const direct = premiumStill({ W: 2007, H: 2853, img, caption: { title: 'Flat.', sub: 'As before.' }, brand, theme: FLAT_GROUND, frame: 'duo-inner' });
  const viaBuild = await pixels(shot.file);
  const flatPixels = direct.getContext('2d').getImageData(0, 0, 2007, 2853).data;
  let same = true;
  for (let i = 0; i < flatPixels.length && same; i += 4) {
    same = flatPixels[i] === viaBuild.d[i] && flatPixels[i + 1] === viaBuild.d[i + 1] && flatPixels[i + 2] === viaBuild.d[i + 2];
  }
  assert.ok(same, 'the build drew the flat frame the flat frame draws');
  // The flat body is square to the frame: its left edge is the same column near its top and near its bottom.
  const leftEdge = (y) => {
    for (let x = 0; x < 2007; x++) {
      const o = (y * 2007 + x) * 4;
      if (Math.abs(viaBuild.d[o] - viaBuild.d[x * 4]) > 2) return x;
    }
    return -1;
  };
  assert.equal(leftEdge(Math.round(2853 * 0.4)), leftEdge(Math.round(2853 * 0.8)));
});

test('a plain shot of a half-open scene shows the capture alone, as any plain shot does', async () => {
  const [folded] = await shoot('bleed-fold', 'appstore-iphone-duo-inner', [{ id: 'a', image: laptopPng, fold: 'laptop' }], { style: 'bleed', caption: false });
  const [flat] = await shoot('bleed-flat', 'appstore-iphone-duo-inner', [{ id: 'a', image: laptopPng }], { style: 'bleed', caption: false });
  assert.deepEqual(fs.readFileSync(folded.file), fs.readFileSync(flat.file));
});

test('fold is refused where the picture would be of a posture the phone was not in', async () => {
  await assert.rejects(
    shoot('wrong-frame', 'appstore-iphone-6.9', [{ id: 'a', image: laptopPng, fold: 'laptop' }]),
    /appstore-iphone-6\.9: scene "a" is half open \(fold: 'laptop'\), which only the Duo's inner display frame draws/,
  );
  await assert.rejects(
    shoot('wrong-shape', 'appstore-iphone-duo-inner-landscape', [{ id: 'a', image: bookPng, fold: 'laptop' }]),
    /scene "a" says fold: 'laptop', but book\.png is 286×201/,
  );
  const frame = createCanvas(400, 600);
  assert.throws(() => drawFoldedDuo(frame.getContext('2d'), captureCanvas(false), 200, 300, 200, { fold: 'book' }), /'book' needs a wide capture/);
});
