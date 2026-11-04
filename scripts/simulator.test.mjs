// `zdymak capture` on iOS shuts down at teardown only a simulator it booted itself. A simulator found by --device that
// was already booted (by the user, or by a tool that keeps one device up between runs) is left running.
//   node --test scripts/simulator.test.mjs        (or: npm run check:simulator)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OLD = '11111111-1111-1111-1111-111111111111';
const NEW = '22222222-2222-2222-2222-222222222222';
const PAD = '33333333-3333-3333-3333-333333333333';

const available = `== Devices ==
-- iOS 26.5 --
    iPhone 18 Pro Max (${OLD}) (Shutdown)
-- iOS 27.2 --
    iPhone 18 Pro Max (${NEW}) (Shutdown)
    iPad Pro 13-inch (M5) (${PAD}) (Shutdown)
`;

/** A stand-in `xcrun` on PATH: `simctl list devices available` prints [available], `… booted` prints [booted]. */
function fakeXcrun(t, booted) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zdymak-sim-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'available.txt'), available);
  fs.writeFileSync(path.join(dir, 'booted.txt'), `== Devices ==\n-- iOS 27.2 --\n${booted}`);
  const script = path.join(dir, 'xcrun');
  fs.writeFileSync(script, `#!/bin/sh
case "$*" in
  "simctl list devices available") cat "${dir}/available.txt" ;;
  "simctl list devices booted") cat "${dir}/booted.txt" ;;
  *) echo "unexpected: $*" >&2; exit 1 ;;
esac
`);
  fs.chmodSync(script, 0o755);
  const before = process.env.PATH;
  process.env.PATH = `${dir}:${before}`;
  t.after(() => { process.env.PATH = before; });
}

const { resolveIosSim } = await import('../src/capture/simulator.mjs');

test('--device names a shut-down simulator: the capture boots it, on the newest runtime, and so tears it down', (t) => {
  fakeXcrun(t, '');
  assert.deepEqual(resolveIosSim({ device: 'iPhone 18 Pro Max' }), { udid: NEW, booted: true, created: false });
});

test('--device names a simulator that is already booted: the capture leaves it booted', (t) => {
  fakeXcrun(t, `    iPhone 18 Pro Max (${NEW}) (Booted)\n`);
  assert.deepEqual(resolveIosSim({ device: 'iPhone 18 Pro Max' }), { udid: NEW, booted: false, created: false });
});

test('another booted simulator does not count as the one --device names', (t) => {
  fakeXcrun(t, `    iPad Pro 13-inch (M5) (${PAD}) (Booted)\n`);
  assert.deepEqual(resolveIosSim({ device: 'iPhone 18 Pro Max' }), { udid: NEW, booted: true, created: false });
});

test('--udid and no --device behave as before', (t) => {
  fakeXcrun(t, `    iPad Pro 13-inch (M5) (${PAD}) (Booted)\n`);
  assert.deepEqual(resolveIosSim({ udid: PAD }), { udid: PAD, booted: false, created: false });
  assert.deepEqual(resolveIosSim({ udid: NEW }), { udid: NEW, booted: true, created: false });
  assert.deepEqual(resolveIosSim({}), { udid: PAD, booted: false, created: false });
});
