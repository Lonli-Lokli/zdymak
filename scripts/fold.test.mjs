// The iPhone Duo's postures as `--posture` names them: each one's shape and screen, and the angles a
// half-open one may take. The simulator half (the helper, the displays) needs Xcode 27.1 and is
// exercised by a capture, not here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HALF_OPEN, POSTURES, READS, awaitDisplay, fold, iosLaunchReady, launchApp, logStart, parseDisplays, postureDisplay, postureOf, screenshotArgs,
  shotFailure,
} from '../src/capture/fold.mjs';

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

// A scripted devicectl: each read takes the next value, and the last one repeats.
const reader = (values) => { let i = 0; return () => values[Math.min(i++, values.length - 1)]; };
const noWait = () => {};

test('awaitDisplay counts reads, not seconds: three in a row of the wanted screen is enough', () => {
  assert.equal(awaitDisplay(reader(['1', '3', '3', '3']), '3', 20, noWait), null);
  // A flicker breaks the streak and it starts again.
  assert.equal(awaitDisplay(reader(['3', '3', '1', '3', '3', '3']), '3', 20, noWait), null);
  // However slow each read is, the wait makes all its reads before it gives up, and returns them.
  const slow = () => { const t = Date.now(); while (Date.now() - t < 5); return '1'; };
  const seen = awaitDisplay(slow, '3', 4, noWait);
  assert.deepEqual(seen, ['1', '1', '1', '1']);
  assert.deepEqual(awaitDisplay(reader([null]), '1', 2, noWait), ['none', 'none']);
});

test('awaitDisplay pauses a second between reads', () => {
  const waits = [];
  awaitDisplay(reader(['1']), '3', 3, (ms) => waits.push(ms));
  assert.deepEqual(waits, [1000, 1000, 1000]);
});

test('the read budgets are the measured ones: 60 just after a boot, 20 after a fold, 10 before a shot', () => {
  assert.deepEqual(READS, { first: 60, fold: 20, shot: 10 });
});

test('fold closes, waits for the outer screen, opens flat, turns, then folds back', () => {
  const sent = [];
  const on = fold(postureOf('half-laptop'), { outer: '1', want: '3', send: (...a) => sent.push(a.join(' ')),
    read: reader(['1', '1', '1', '3']), wait: noWait });
  assert.equal(on, '3');
  assert.deepEqual(sent, ['hinge 0', 'hinge-sweep 0 180 0.6', 'orientation landscape-left', `hinge-sweep 180 ${HALF_OPEN} 0.8`]);
});

test('fold folds once more when the wanted screen does not come on, and refuses a second miss with both reads', () => {
  const sent = [];
  let reads = 0;
  // Closed (outer on) for the first wait, the inner never comes on in two waits of 20 reads, then closed again,
  // then inner.
  const script = [...Array(3).fill('1'), ...Array(2 * READS.fold).fill('1'), ...Array(3).fill('1'), '3'];
  const logged = [];
  const on = fold(postureOf('half-book'), { outer: '1', want: '3', send: (...a) => sent.push(a.join(' ')),
    read: () => script[Math.min(reads++, script.length - 1)], wait: noWait, log: (l) => logged.push(l) });
  assert.equal(on, '3');
  assert.equal(sent.filter((c) => c === 'hinge 0').length, 2);
  assert.match(logged[0], /half-book: the inner screen \(display 3\) did not come on .*folding once more/);

  assert.throws(
    () => fold(postureOf('half-book'), { outer: '1', want: '3', send: () => {}, read: reader(['1']), wait: noWait }),
    (e) => /half-book wants the inner screen \(display 3\) on/.test(e.message) && /\| again:/.test(e.message),
  );
});

test('a wanted screen that comes on after its reads ran out gets one more wait, not a re-fold', () => {
  // One store run (2026-11-05): open's inner screen came on two reads after its 20, just as the re-fold closed the
  // phone, so the closing read the inner screen (1, 1, 3, 3, …) and the posture was refused for the outer one.
  const sent = [];
  let reads = 0;
  const script = [...Array(3).fill('1'), ...Array(READS.fold).fill('1'), '1', '1', '3'];
  const logged = [];
  const on = fold(postureOf('open'), { outer: '1', want: '3', send: (...a) => sent.push(a.join(' ')),
    read: () => script[Math.min(reads++, script.length - 1)], wait: noWait, log: (l) => logged.push(l) });
  assert.equal(on, '3');
  assert.equal(sent.filter((c) => c === 'hinge 0').length, 1);
  assert.match(logged[0], /open: the inner screen \(display 3\) came on late/);
});

test('a retry whose closing fails names the wanted screen and the closing, not the outer screen alone', () => {
  let reads = 0;
  // Closed, then the inner never comes on in two waits, then closed again never reads the outer.
  const script = [...Array(3).fill('1'), ...Array(2 * READS.fold).fill('1'), ...Array(READS.fold).fill('none')];
  assert.throws(
    () => fold(postureOf('half-book'), { outer: '1', want: '3', send: () => {},
      read: () => script[Math.min(reads++, script.length - 1)], wait: noWait }),
    (e) => /^half-book wants the inner screen \(display 3\) on/.test(e.message)
      && /folding it closed again, the outer screen \(display 1\) never came on/.test(e.message),
  );
});

test('every shot of a phone that folds names its display; a phone with one screen does not', () => {
  assert.deepEqual(screenshotArgs('U', '/x/p.png', '3'), ['simctl', 'io', 'U', 'screenshot', '--display=3', '/x/p.png']);
  assert.deepEqual(screenshotArgs('U', '/x/p.png'), ['simctl', 'io', 'U', 'screenshot', '/x/p.png']);
});

test('the settle probe takes the posture\'s display', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/capture/index.mjs', import.meta.url), 'utf8');
  assert.match(src, /shootDisplay\(udid, display, probe\)/);
  assert.match(src, /settleFrame\(udid, outDir, \{ display: on \}\)/);
});

test('a display shot that fails says whether the screen was still on, and how long the earlier shots took', () => {
  const on = shotFailure({ display: '1', timedOut: true, stderr: 'Detected file type from extension: PNG', after: ['1', '1', '1'], times: [800, 2400], load: '9.1 8.0 7.2', logFile: '/x/.shot-failed.log' });
  assert.match(on, /within 15 s/);
  assert.match(on, /still on, so simctl was slow, not the screen off/);
  assert.match(on, /2 display shot\(s\) before it took up to 2\.4 s/);
  assert.match(on, /\/x\/\.shot-failed\.log/);
  assert.doesNotMatch(on, /that screen is off/);
  const off = shotFailure({ display: '1', timedOut: true, stderr: '', after: ['3', 'none', '3'], times: [], load: '1.0', logFile: null });
  assert.match(off, /that screen was not on/);
  assert.match(off, /no earlier shot/);
});

test('the simulator log starts at the posture, in the local time log show reads', () => {
  assert.equal(logStart(new Date(2026, 10, 5, 9, 4, 7)), '2026-11-05 09:04:07');
});

test('a simulator is ready to launch again when the app holds no process and SpringBoard does', () => {
  const head = 'PID\tStatus\tLabel\n';
  const board = '88\t0\tcom.apple.SpringBoard\n';
  assert.equal(iosLaunchReady(`${head}${board}-\t0\tUIKitApplication:com.example.app[a1b2][rb-legacy]\n`, 'com.example.app'), true);
  assert.equal(iosLaunchReady(`${head}${board}`, 'com.example.app'), true, 'the app not listed at all');
  assert.equal(iosLaunchReady(`${head}${board}4242\t0\tUIKitApplication:com.example.app[a1b2]\n`, 'com.example.app'), false, 'the old process still up');
  assert.equal(iosLaunchReady(`${head}-\t0\tcom.apple.SpringBoard\n`, 'com.example.app'), false, 'SpringBoard not up');
  assert.equal(iosLaunchReady('', 'com.example.app'), false, 'launchctl said nothing');
});

test('a launch that gets no process is tried once more, after the simulator reads ready', () => {
  const noProcess = { status: 1, stderr: 'Simulator device failed to launch com.example.app.\nNo such process' };
  const results = [noProcess, { status: 0 }];
  const readies = [false, true, true, true];
  const waits = [];
  const got = launchApp({ launch: () => results.shift(), ready: () => readies.shift(), wait: (ms) => waits.push(ms) });
  assert.deepEqual(got, { retried: true, reads: null });
  assert.equal(results.length, 0, 'launched twice');
  assert.equal(waits.length, 3, 'a second between reads until three agree');
});

test('a launch is retried only for "No such process", and only once', () => {
  assert.deepEqual(launchApp({ launch: () => ({ status: 0 }), ready: () => assert.fail('no wait without a failure') }), { retried: false });
  assert.throws(() => launchApp({ launch: () => ({ status: 1, stderr: 'Unable to find bundle' }), ready: () => true, wait: () => {} }), /launch failed: Unable to find bundle/);
  let launches = 0;
  const twice = () => launchApp({ launch: () => { launches++; return { status: 1, stderr: 'No such process' }; }, ready: () => false, wait: () => {} });
  assert.throws(twice, new RegExp(`failed twice, the second time after ${READS.fold} reads that never read ready`));
  assert.equal(launches, 2);
});

