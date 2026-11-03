// The Android foldable postures and turn that `capture --platform android --posture/--orientation` set over adb.
//   node --test scripts/android-fold.test.mjs        (part of: npm run check:fold)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANDROID_POSTURES, androidPostureOf, parseCurrentState, parseDeviceStates, parseHinge, parseWmSize, rotationFor, shapeMatches,
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
