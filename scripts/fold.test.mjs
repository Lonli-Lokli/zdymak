// The iPhone Duo's postures as `--posture` names them: each one's shape and screen, and the angles a
// half-open one may take. The simulator half (the helper, the displays) needs Xcode 27.1 and is
// exercised by a capture, not here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HALF_OPEN, POSTURES, parseDisplays, postureDisplay, postureOf } from '../src/capture/fold.mjs';

test('every posture names a hinge, an orientation, a screen and a shape', () => {
  for (const [name, p] of Object.entries(POSTURES)) {
    assert.ok([0, HALF_OPEN, 180].includes(p.hinge), name);
    assert.match(p.orientation, /^(portrait|landscape-left|landscape-right)$/, name);
    assert.ok(p.screen === (p.hinge === 0 ? 'outer' : 'inner'), `${name}: the outer screen is on only when closed`);
    assert.equal(typeof p.wide, 'boolean', name);
  }
});

test('the open phone held upright is wide, as a book is, and turned it is tall', () => {
  assert.equal(POSTURES.open.wide, true);
  assert.equal(POSTURES['half-book'].wide, true);
  assert.equal(POSTURES['open-upright'].wide, false);
  assert.equal(POSTURES['half-laptop'].wide, false);
  assert.equal(POSTURES.closed.wide, false);
  assert.equal(POSTURES['closed-turned'].wide, true);
});

test('--hinge moves a half-open posture only, and only where the inner screen stays on', () => {
  assert.equal(postureOf('half-laptop', '95').hinge, 95);
  assert.equal(postureOf('Half-Book').name, 'half-book');
  assert.equal(postureOf('open', '95').hinge, 180);
  assert.throws(() => postureOf('half-book', '20'), /between 35 and 130/);
  assert.throws(() => postureOf('half-book', '150'), /between 35 and 130/);
  assert.throws(() => postureOf('flat'), /--posture must be one of/);
});

// The headers of `devicectl device info displays` on the iOS 27.1 Duo simulator (2026-10-13), closed and at rest.
const closed = `Current Displays:
▿ 1: LCD (primary) (active):
    • bounds: (0.0, 0.0, 1398.0, 2034.0)
▿ 3: LCD-1:
    • bounds: (0.0, 0.0, 2007.0, 2853.0)
Main display backlight state: backlight is on and active`;
// One read in six, with the phone still closed, named the inner screen as the one on.
const flicker = closed.replace('LCD (primary) (active):', 'LCD (primary):').replace('LCD-1:', 'LCD-1 (active):');

test('the displays are read with which one is primary and which one is on', () => {
  assert.deepEqual(parseDisplays(closed), [
    { id: '1', active: true, primary: true },
    { id: '3', active: false, primary: false },
  ]);
});

test('a posture shows the primary display when closed and the other when open, whichever reads as on', () => {
  for (const list of [parseDisplays(closed), parseDisplays(flicker)]) {
    assert.equal(postureDisplay(list, POSTURES.closed), '1');
    assert.equal(postureDisplay(list, POSTURES['closed-turned']), '1');
    assert.equal(postureDisplay(list, POSTURES['half-book']), '3');
    assert.equal(postureDisplay(list, POSTURES.open), '3');
  }
  assert.throws(() => postureDisplay(parseDisplays('▿ 1: LCD (active):'), POSTURES.open), /no primary and second screen/);
});
