// The Android foldable postures and turn that `capture --platform android --posture/--orientation` set over adb.
//   node --test scripts/android-fold.test.mjs        (part of: npm run check:fold)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANDROID_POSTURES, androidPostureOf, enterAndroidPosture, parseCurrentState, parseDeviceStates, parseHinge, parseWmSize, rotationFor,
  shapeMatches,
} from '../src/capture/android-fold.mjs';

// Verbatim from a book-fold and a flip emulator profile (API 36): the ids differ, the names do not.
const BOOK = "Supported states: [   DeviceState{identifier=0, name='CLOSED', app_accessible=true, cancel_when_requester_not_on_top=false},   DeviceState{identifier=1, name='HALF_OPENED', app_accessible=true, cancel_when_requester_not_on_top=false},   DeviceState{identifier=2, name='OPENED', app_accessible=true, cancel_when_requester_not_on_top=false},   DeviceState{identifier=3, name='REAR_DISPLAY_MODE', app_accessible=true, cancel_when_requester_not_on_top=false}, ]";
const FLIP = "Supported states: [   DeviceState{identifier=1, name='CLOSED', app_accessible=true, cancel_when_requester_not_on_top=false},   DeviceState{identifier=2, name='HALF_OPENED', app_accessible=true, cancel_when_requester_not_on_top=false},   DeviceState{identifier=3, name='OPENED', app_accessible=true, cancel_when_requester_not_on_top=false}, ]";

test('every posture names a hinge angle and the device state the system must report', () => {
  assert.deepEqual(Object.keys(ANDROID_POSTURES), ['closed', 'half-open', 'open']);
  for (const p of Object.values(ANDROID_POSTURES)) {
    assert.ok(p.hinge >= 0 && p.hinge <= 180);
    assert.match(p.state, /^(CLOSED|HALF_OPENED|OPENED)$/);
  }
});

test('the state ids are read by name, since a book fold and a flip number them differently', () => {
  const book = parseDeviceStates(BOOK);
  const flip = parseDeviceStates(FLIP);
  assert.equal(book.get(0), 'CLOSED');
  assert.equal(book.get(3), 'REAR_DISPLAY_MODE');
  assert.equal(flip.get(1), 'CLOSED');
  assert.equal(flip.get(3), 'OPENED');
  assert.equal(parseCurrentState('2\n'), 2);
  assert.equal(parseCurrentState('DeviceState{identifier=1, name=\'HALF_OPENED\'}'), 1);
  assert.equal(parseCurrentState(''), null);
});

test('--hinge moves half-open only, strictly between closed and flat; an unknown posture is refused', () => {
  assert.equal(androidPostureOf('half-open').hinge, 90);
  assert.equal(androidPostureOf('half-open', '60').hinge, 60);
  assert.equal(androidPostureOf('OPEN', '60').hinge, 180);
  assert.throws(() => androidPostureOf('half-open', '180'), /between 0 and 180/);
  assert.throws(() => androidPostureOf('half-book'), /closed, half-open, open/);
});

test('the console hinge and the screen size are read from adb as it prints them', () => {
  assert.equal(parseHinge('hinge-angle0 = 180\nOK\n'), 180);
  assert.equal(parseHinge('KO: unknown sensor name: hinge-angle0'), null);
  assert.deepEqual(parseWmSize('Physical size: 1080x2400\nOverride size: 1920x1080\n'), { w: 1920, h: 1080 });
  assert.deepEqual(parseWmSize('Physical size: 1024x600\n'), { w: 1024, h: 600 });
});

test('portrait and landscape ask for the rotation that gives that shape on this screen', () => {
  const tablet7 = { w: 1024, h: 600 }; // wide at rotation 0
  const phone = { w: 1080, h: 2636 };
  assert.equal(rotationFor('landscape', tablet7), 0);
  assert.equal(rotationFor('portrait', tablet7), 1);
  assert.equal(rotationFor('portrait', phone), 0);
  assert.equal(rotationFor('landscape', phone), 1);
  assert.throws(() => rotationFor('landscape-left', phone), /portrait or landscape/);
});

test('a shot of the other shape is caught, and a square one passes either way', () => {
  assert.equal(shapeMatches('landscape', 1024, 600), true);
  assert.equal(shapeMatches('landscape', 600, 1024), false);
  assert.equal(shapeMatches('portrait', 2076, 2152), true);
  assert.equal(shapeMatches('portrait', 1000, 1000), true);
});

test('a screencap with a warning ahead of the picture is cut at the PNG signature; one with no picture is refused', async () => {
  const { pngFromScreencap } = await import('../src/capture/android-fold.mjs');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const warned = Buffer.concat([Buffer.from('[Warning] Multiple displays were found, but no display id was specified!\n'), png]);
  const cut = pngFromScreencap(warned);
  assert.deepEqual([...cut.png], [...png]);
  assert.match(cut.note, /Multiple displays/);
  assert.equal(pngFromScreencap(png).note, null);
  assert.throws(() => pngFromScreencap(Buffer.from('error: device offline')), /no PNG: error: device offline/);
});

/**
 * A book fold emulator over a fake adb, on a fake clock: the device state follows the hinge at once, as the system
 * reports it, and the display follows `lag` ms later (never, with Infinity). `sizes` is each state's `wm size`, or a
 * function of the read's number for a display that will not settle.
 */
function fakeFold({ hinge = 180, lag = 1200, sizes = { CLOSED: '1080x2092', HALF_OPENED: '2208x1840', OPENED: '2208x1840' } } = {}) {
  let now = 0;
  let reads = 0;
  const clock = { now: () => now, sleep: (ms) => { now += ms; } };
  const stateOf = (angle) => (angle === 0 ? 'CLOSED' : angle === 180 ? 'OPENED' : 'HALF_OPENED');
  const ids = { CLOSED: 0, HALF_OPENED: 1, OPENED: 2 };
  let shown = sizes[stateOf(hinge)];
  let movedAt = -Infinity;
  const size = () => {
    reads++;
    if (typeof sizes === 'function') return sizes(reads);
    return now - movedAt >= lag ? sizes[stateOf(hinge)] : shown;
  };
  const sets = [];
  const ok = (out) => ({ ok: true, out });
  const adb = {
    emu: (...args) => {
      if (args[1] === 'get') return ok(`hinge-angle0 = ${hinge}\nOK\n`);
      if (typeof sizes !== 'function') shown = now - movedAt >= lag ? sizes[stateOf(hinge)] : shown;
      hinge = Number(args[3]);
      movedAt = now;
      sets.push(hinge);
      return ok('OK\n');
    },
    shell: (...args) => {
      if (args.join(' ') === 'cmd device_state print-states') return ok(BOOK);
      if (args.join(' ') === 'cmd device_state print-state') return ok(`${ids[stateOf(hinge)]}\n`);
      if (args.join(' ') === 'wm size') return ok(`Physical size: ${size()}\n`);
      return ok('');
    },
  };
  adb.run = (cmd, ...rest) => adb[cmd](...rest);
  return { adb, clock, sets, now: () => now, wmSize: () => adb.shell('wm', 'size').out };
}

test('a posture is entered once the display has followed the device state, not the moment the state flips', () => {
  // Closing a book fold: CLOSED is reported at once and the outer screen's size 1.2 s later, as a capture saw it.
  const closing = fakeFold({ hinge: 180 });
  const closed = enterAndroidPosture(androidPostureOf('closed'), { adb: closing.adb, clock: closing.clock });
  assert.equal(closed.previous, 180);
  assert.equal(parseWmSize(closing.wmSize()).w, 1080, 'the cover screen\'s size, not the inner one\'s');
  assert.deepEqual(closed.size, { w: 1080, h: 2092 });
  // Opening it again: the inner screen's size.
  const opening = fakeFold({ hinge: 0 });
  enterAndroidPosture(androidPostureOf('open'), { adb: opening.adb, clock: opening.clock });
  assert.equal(parseWmSize(opening.wmSize()).w, 2208);
  // Half open from open keeps one display: three reads that agree are enough, nothing waits for a change.
  const half = fakeFold({ hinge: 180 });
  enterAndroidPosture(androidPostureOf('half-open'), { adb: half.adb, clock: half.clock });
  assert.ok(half.now() < 2000, `settled in ${half.now()} ms`);
});

test('a display that never follows the posture, or never settles, fails the posture and puts the hinge back', () => {
  const stuck = fakeFold({ hinge: 180, lag: Infinity });
  assert.throws(() => enterAndroidPosture(androidPostureOf('closed'), { adb: stuck.adb, clock: stuck.clock, maxMs: 5000 }),
    /CLOSED.*still 2208x1840/);
  assert.deepEqual(stuck.sets, [0, 180], 'the hinge is put back where it was');
  const restless = fakeFold({ hinge: 180, sizes: (n) => (n % 2 ? '2208x1840' : '2208x1841') });
  assert.throws(() => enterAndroidPosture(androidPostureOf('half-open'), { adb: restless.adb, clock: restless.clock, maxMs: 5000 }),
    /still changing/);
  assert.deepEqual(restless.sets, [90, 180]);
});
