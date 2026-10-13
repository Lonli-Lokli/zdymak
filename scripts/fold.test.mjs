// The iPhone Duo's postures as `--posture` names them: each one's shape and screen, and the angles a
// half-open one may take. The simulator half (the helper, the displays) needs Xcode 27.1 and is
// exercised by a capture, not here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HALF_OPEN, POSTURES, postureOf } from '../src/capture/fold.mjs';

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
