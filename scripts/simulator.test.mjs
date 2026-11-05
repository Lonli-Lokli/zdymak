// `zdymak capture` on iOS shuts down at teardown only a simulator it booted itself. A simulator found by --device that
// was already booted (by the user, or by a tool that keeps one device up between runs) is left running.
// It installs an app an earlier run built (--app, --app-out), gives scripts the same boot and teardown (openIosSim,
// closeIosSim), and asks a turn twice before it calls the device unturned.
//   node --test scripts/simulator.test.mjs        (or: npm run check:simulator)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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

/* ── A prebuilt app (--app), a build handed on (--app-out), and the library calls ─────────────────────────────── */

/**
 * Stand-ins on PATH: an `xcrun` that answers the two device lists and LOGS every boot, bootstatus, install, shutdown
 * and delete (anything else fails), and a `plutil` that reads CFBundleIdentifier out of an XML Info.plist, so the tests
 * run where there is no Xcode. Returns the log reader and a factory for built `.app` folders.
 */
function fakeTools(t, booted) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zdymak-app-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'available.txt'), available);
  fs.writeFileSync(path.join(dir, 'booted.txt'), `== Devices ==\n-- iOS 27.2 --\n${booted}`);
  const log = path.join(dir, 'calls.txt');
  fs.writeFileSync(path.join(dir, 'xcrun'), `#!/bin/sh
case "$*" in
  "simctl list devices available") cat "${dir}/available.txt" ;;
  "simctl list devices booted") cat "${dir}/booted.txt" ;;
  "simctl boot "*|"simctl bootstatus "*|"simctl install "*|"simctl shutdown "*|"simctl delete "*) echo "$*" >> "${log}" ;;
  *) echo "unexpected: $*" >&2; exit 1 ;;
esac
`);
  fs.writeFileSync(path.join(dir, 'plutil'), `#!/bin/sh
[ "$1 $2 $3 $4 $5" = "-extract CFBundleIdentifier raw -o -" ] || { echo "unexpected: $*" >&2; exit 1; }
awk '/CFBundleIdentifier/ { getline; gsub(/.*<string>|<\\/string>.*/, ""); print; found = 1; exit } END { exit !found }' "$6"
`);
  fs.chmodSync(path.join(dir, 'xcrun'), 0o755);
  fs.chmodSync(path.join(dir, 'plutil'), 0o755);
  const before = process.env.PATH;
  process.env.PATH = `${dir}:${before}`;
  t.after(() => { process.env.PATH = before; });
  return {
    dir,
    calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []),
    /** A built app folder whose Info.plist names `bundle` (none at all when `bundle` is null). */
    app(name, bundle) {
      const app = path.join(dir, 'Build', `${name}.app`);
      fs.mkdirSync(app, { recursive: true });
      if (bundle !== null) {
        fs.writeFileSync(path.join(app, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>CFBundleName</key>
  <string>${name}</string>
  <key>CFBundleIdentifier</key>
  <string>${bundle}</string>
</dict></plist>
`);
      }
      return app;
    },
  };
}

const sim = await import('../src/capture/simulator.mjs');

test('--app: the bundle id comes from the app, so --bundle can be left out', (t) => {
  const tools = fakeTools(t, '');
  const app = tools.app('Sample', 'org.example.sample');
  const flags = sim.withPrebuiltApp({ platform: 'ios', app, states: 'a,b', arg: '-screen' });
  assert.equal(flags.app, app);
  assert.equal(flags.bundle, 'org.example.sample');
});

test('--app: a --bundle that matches passes, a different one is refused', (t) => {
  const tools = fakeTools(t, '');
  const app = tools.app('Sample', 'org.example.sample');
  assert.equal(sim.withPrebuiltApp({ app, states: 'a', bundle: 'org.example.sample' }).bundle, 'org.example.sample');
  assert.throws(() => sim.withPrebuiltApp({ app, states: 'a', bundle: 'org.example.other' }), /org\.example\.sample, not org\.example\.other/);
});

test('--app: a relative path is made absolute', (t) => {
  const tools = fakeTools(t, '');
  const app = tools.app('Sample', 'org.example.sample');
  const cwd = process.cwd();
  process.chdir(path.dirname(app));
  t.after(() => process.chdir(cwd));
  assert.equal(fs.realpathSync(sim.withPrebuiltApp({ app: 'Sample.app', states: 'a' }).app), fs.realpathSync(app));
});

test('--app is refused with --build, without --states, with no path, and for a folder that is not a built app', (t) => {
  const tools = fakeTools(t, '');
  const app = tools.app('Sample', 'org.example.sample');
  assert.throws(() => sim.withPrebuiltApp({ app, build: true, states: 'a' }), /drop --build/);
  assert.throws(() => sim.withPrebuiltApp({ app, name: 'shot' }), /--states/);
  assert.throws(() => sim.withPrebuiltApp({ app: true, states: 'a' }), /needs the path of a built \.app/);
  assert.throws(() => sim.withPrebuiltApp({ app: path.join(tools.dir, 'Missing.app'), states: 'a' }), /no Info\.plist/);
  assert.throws(() => sim.withPrebuiltApp({ app: tools.app('Bare', null), states: 'a' }), /no Info\.plist/);
  assert.deepEqual(tools.calls(), [], 'nothing booted or installed');
});

test('--app-out needs --build and a file; flags without --app or --app-out pass through unchanged', () => {
  assert.throws(() => sim.withPrebuiltApp({ 'app-out': 'out/app.txt', states: 'a' }), /needs --build/);
  assert.throws(() => sim.withPrebuiltApp({ 'app-out': true, build: true, states: 'a' }), /needs a file/);
  const flags = { build: true, 'app-out': 'out/app.txt', states: 'a', bundle: 'org.example.sample' };
  assert.equal(sim.withPrebuiltApp(flags), flags);
  const plain = { states: 'a', bundle: 'org.example.sample' };
  assert.equal(sim.withPrebuiltApp(plain), plain);
});

test('--app-out: the built app\'s path and a newline, in a folder made for it; the path is printed either way', (t) => {
  const tools = fakeTools(t, '');
  const app = tools.app('Sample', 'org.example.sample');
  const file = path.join(tools.dir, 'out', 'nested', 'app-path.txt');
  const lines = [];
  sim.recordBuiltApp(app, { build: true, 'app-out': file }, (l) => lines.push(l));
  assert.equal(fs.readFileSync(file, 'utf8'), `${app}\n`);
  assert.ok(lines.some((l) => l === `▸ app: ${app}`), lines.join('\n'));
  const quiet = [];
  sim.recordBuiltApp(app, { build: true }, (l) => quiet.push(l));
  assert.deepEqual(quiet, [`▸ app: ${app}`]);
});

test('openIosSim boots a shut-down simulator and installs the app; closeIosSim shuts down what it booted', (t) => {
  const tools = fakeTools(t, '');
  const app = tools.app('Sample', 'org.example.sample');
  const s = sim.openIosSim({ device: 'iPhone 18 Pro Max', app });
  assert.deepEqual(s, { udid: NEW, booted: true, created: false, bundle: 'org.example.sample' });
  assert.deepEqual(tools.calls(), [`simctl boot ${NEW}`, `simctl bootstatus ${NEW} -b`, `simctl install ${NEW} ${app}`]);
  assert.equal(sim.closeIosSim(s), true);
  assert.deepEqual(tools.calls().slice(3), [`simctl shutdown ${NEW}`]);
});

test('openIosSim on a simulator that is already booted installs without booting; closeIosSim leaves it up', (t) => {
  const tools = fakeTools(t, `    iPhone 18 Pro Max (${NEW}) (Booted)\n`);
  const app = tools.app('Sample', 'org.example.sample');
  const s = sim.openIosSim({ udid: NEW, app, bundle: 'org.example.sample' });
  assert.deepEqual(s, { udid: NEW, booted: false, created: false, bundle: 'org.example.sample' });
  assert.deepEqual(tools.calls(), [`simctl install ${NEW} ${app}`]);
  assert.equal(sim.closeIosSim(s), false);
  assert.deepEqual(tools.calls(), [`simctl install ${NEW} ${app}`]);
});

test('closeIosSim: keep leaves a simulator it booted up; a device it created is deleted', (t) => {
  const tools = fakeTools(t, '');
  assert.equal(sim.closeIosSim({ udid: NEW, booted: true, created: false }, { keep: true }), false);
  assert.deepEqual(tools.calls(), []);
  assert.equal(sim.closeIosSim({ udid: PAD, booted: true, created: true }), true);
  assert.deepEqual(tools.calls(), [`simctl shutdown ${PAD}`, `simctl delete ${PAD}`]);
});

test('openIosSim refuses an app whose bundle id is not the one asked for, before it boots anything', (t) => {
  const tools = fakeTools(t, '');
  const app = tools.app('Sample', 'org.example.sample');
  assert.throws(() => sim.openIosSim({ device: 'iPhone 18 Pro Max', app, bundle: 'org.example.other' }), /not org\.example\.other/);
  assert.deepEqual(tools.calls(), []);
});

test('the CLI refuses --app with --build before it calls xcrun at all', (t) => {
  const tools = fakeTools(t, '');
  const app = tools.app('Sample', 'org.example.sample');
  const bin = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'bin', 'zdymak.mjs');
  const xcrunLog = path.join(tools.dir, 'every-xcrun.txt');
  // An xcrun that logs EVERY call, so "nothing ran" is a fact rather than a guess.
  fs.writeFileSync(path.join(tools.dir, 'xcrun'), `#!/bin/sh\necho "$*" >> "${xcrunLog}"\n`);
  const r = spawnSync(process.execPath, [bin, 'capture', '--platform', 'ios', '--arg', '-screen', '--states', 'a',
    '--app', app, '--build', '--project', 'X.xcodeproj', '--scheme', 'X', '--out', path.join(tools.dir, 'shots')],
  { encoding: 'utf8', cwd: tools.dir, env: { ...process.env, DEVELOPER_DIR: tools.dir } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /drop --build/);
  assert.equal(fs.existsSync(xcrunLog), false, 'xcrun was called');
});

/* ── Turning an inherited simulator ────────────────────────────────────────────────────────────────────────── */

test('bootedSims reads names and udids from simctl list devices booted', () => {
  const list = `== Devices ==\n-- iOS 27.2 --\n    iPhone 18 Pro Max (${NEW}) (Booted)\n    iPad Pro 13-inch (M5) (${PAD}) (Booted)\n`;
  assert.deepEqual(sim.bootedSims(list), [
    { name: 'iPhone 18 Pro Max', udid: NEW },
    { name: 'iPad Pro 13-inch (M5)', udid: PAD },
  ]);
  assert.deepEqual(sim.bootedSims('== Devices ==\n'), []);
});

test('simulatorWindowFor picks the device\'s own window by its whole name', () => {
  const windows = ['iPhone 18 Pro Max – iOS 26.5', 'iPhone 18 Pro – iOS 26.5', 'iPad Pro 13-inch (M5) – iOS 26.5'];
  assert.equal(sim.simulatorWindowFor(windows, 'iPhone 18 Pro'), 'iPhone 18 Pro – iOS 26.5');
  assert.equal(sim.simulatorWindowFor(windows, 'iPhone 18 Pro Max'), 'iPhone 18 Pro Max – iOS 26.5');
  assert.equal(sim.simulatorWindowFor(windows, 'iPad Pro 13-inch (M5)'), 'iPad Pro 13-inch (M5) – iOS 26.5');
  assert.equal(sim.simulatorWindowFor(['iPhone 18 Pro'], 'iPhone 18 Pro'), 'iPhone 18 Pro');
  assert.equal(sim.simulatorWindowFor(windows, 'iPhone 17'), null);
  assert.equal(sim.simulatorWindowFor([], 'iPhone 18 Pro'), null);
});

/** A device whose framebuffer changes only on the turns listed in [turnsThatTake] (1-based), logging each call. */
function fakeTurns(turnsThatTake) {
  const calls = [];
  let turns = 0;
  let landscape = false;
  return {
    calls,
    toPortrait: async () => { calls.push('portrait'); landscape = false; },
    toTarget: async () => { turns++; calls.push('turn'); landscape = turnsThatTake.includes(turns); },
    frame: async () => { calls.push('frame'); return Buffer.from(landscape ? 'landscape' : 'portrait'); },
  };
}

test('provenTurn: a turn that takes the first time is asked for once', async () => {
  const d = fakeTurns([1]);
  const log = [];
  assert.equal(await sim.provenTurn({ orientation: 'landscape-left', ...d, log: (l) => log.push(l) }), 1);
  assert.deepEqual(d.calls, ['portrait', 'frame', 'turn', 'frame']);
  assert.deepEqual(log, []);
});

test('provenTurn: a turn missed just after boot is asked for once more, from portrait, and passes', async () => {
  const d = fakeTurns([2]);
  const log = [];
  assert.equal(await sim.provenTurn({ orientation: 'landscape-left', ...d, log: (l) => log.push(l) }), 2);
  assert.deepEqual(d.calls, ['portrait', 'frame', 'turn', 'frame', 'portrait', 'frame', 'turn', 'frame']);
  assert.equal(log.length, 1);
  assert.match(log[0], /once more/);
});

test('provenTurn: two missed turns fail, naming the app\'s orientations and any other booted simulator', async () => {
  await assert.rejects(sim.provenTurn({ orientation: 'landscape-left', ...fakeTurns([]), log: () => {} }),
    (e) => /did not turn/.test(e.message) && /UISupportedInterfaceOrientations~ipad/.test(e.message) && !/Also booted/.test(e.message));
  await assert.rejects(
    sim.provenTurn({ orientation: 'landscape-left', ...fakeTurns([]), log: () => {}, others: () => ['iPhone 18 Pro Max'] }),
    /Also booted: iPhone 18 Pro Max/,
  );
});
