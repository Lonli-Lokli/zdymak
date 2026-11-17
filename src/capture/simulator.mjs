// Which iOS simulator a capture runs on, and whether the capture boots it (and so shuts it down at teardown); the app
// it installs when that app was built by an earlier run (--app, --app-out); and the proven turn of a simulator that was
// already running. Kept apart from index.mjs so it can be tested with a stand-in `xcrun` and `plutil` on PATH:
//   node --test scripts/simulator.test.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${(r.stderr || r.stdout || '').trim()}`);
  return r.stdout;
}
const out2 = (cmd, args) => (spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout || '');
const udidRe = /\(([0-9A-Fa-f-]{36})\)/;

/**
 * The UDID of the simulator named exactly `name` on the NEWEST runtime that has one. Installing a runtime gives
 * every model a second device of the same name, and simctl lists runtimes oldest first, so the first match was the
 * older iOS: a capture that should be on iOS 27 quietly ran on 26. Exact, because "iPhone 18 Pro" is a prefix of
 * "iPhone 18 Pro Max".
 */
export function newestSimNamed(name) {
  let runtime = [];
  let best = null;
  for (const line of out2('xcrun', ['simctl', 'list', 'devices', 'available']).split('\n')) {
    const header = line.match(/^-- \S+ ([\d.]+) --/);
    if (header) {
      runtime = header[1].split('.').map(Number);
      continue;
    }
    const udid = line.trim().startsWith(`${name} (`) ? line.match(udidRe)?.[1] : null;
    if (udid && (!best || compareVersions(runtime, best.runtime) > 0)) best = { udid, runtime };
  }
  return best?.udid ?? null;
}

const compareVersions = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
};

/**
 * Find (or create) the iOS simulator a capture runs on, WITHOUT booting it: prefers --udid, then an already-booted
 * sim, then a device matching --device (default iPhone 18 Pro Max), creating one if needed. Returns
 * `{ udid, booted, created }` — the two booleans are the TEARDOWN receipt: they say what this process changes
 * (`booted`: whether it boots the sim, in `startIosSim`), so the cleanup can undo exactly that and leave a
 * simulator the user already had running exactly as they left it. That holds for a simulator found by --device
 * too: one already booted (by the user, or by a tool that keeps a device up between runs) is not shut down here.
 *
 * Booting is a separate step so that `--build` runs first: a booted simulator holds ~1.7 GB, and beside a build
 * (Xcode, plus Gradle and Kotlin/Native for a Compose Multiplatform app) it ran an 8 GB Mac out of memory. The
 * build needs only the device's id.
 */
export function resolveIosSim(flags) {
  if (flags.udid) {
    const wasBooted = out2('xcrun', ['simctl', 'list', 'devices', 'booted']).includes(flags.udid);
    return { udid: flags.udid, booted: !wasBooted, created: false };
  }
  if (!flags.device) {
    const booted = out2('xcrun', ['simctl', 'list', 'devices', 'booted']).match(udidRe);
    if (booted) return { udid: booted[1], booted: false, created: false }; // the user's own sim — leave it alone
  }
  const name = flags.device || 'iPhone 18 Pro Max';
  let created = false;
  let udid = newestSimNamed(name);
  if (!udid) {
    const devtype = out2('xcrun', ['simctl', 'list', 'devicetypes']).split('\n')
      .find((l) => l.trim().startsWith(`${name} (`))?.match(/(com\.apple[^\s)]+)/)?.[1];
    const runtime = out2('xcrun', ['simctl', 'list', 'runtimes', 'ios']).split('\n').reverse()
      .find((l) => /com\.apple[^\s)]+/.test(l))?.match(/(com\.apple[^\s)]+)/)?.[1];
    if (!devtype || !runtime) throw new Error(`Could not resolve a simulator for "${name}".`);
    udid = sh('xcrun', ['simctl', 'create', 'zdymak-capture', devtype, runtime]).trim();
    created = true;
  }
  const wasBooted = !created && out2('xcrun', ['simctl', 'list', 'devices', 'booted']).includes(udid);
  return { udid, booted: !wasBooted, created };
}

/**
 * `{ app, bundle }` for an app that is already built: its absolute path and the CFBundleIdentifier its Info.plist
 * names (read with plutil, which also reads the binary plist a build writes). `bundle`, when given, must be that id:
 * installing one app and launching another would photograph the wrong one.
 */
export function prebuiltApp(appPath, bundle) {
  if (typeof appPath !== 'string' || !appPath.trim()) {
    throw new Error('--app needs the path of a built .app (for example --app build/Debug-iphonesimulator/Sample.app).');
  }
  const app = path.resolve(appPath);
  const plist = path.join(app, 'Info.plist');
  if (!fs.existsSync(plist)) throw new Error(`${app} is not a built .app: it has no Info.plist.`);
  const r = spawnSync('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plist], { encoding: 'utf8' });
  const id = r.status === 0 ? r.stdout.trim() : '';
  if (!id) throw new Error(`could not read CFBundleIdentifier from ${plist}: ${(r.error?.message || r.stderr || '').trim()}`);
  if (typeof bundle === 'string' && bundle && bundle !== id) {
    throw new Error(`${app} is ${id}, not ${bundle}: installing one app and launching another would photograph the wrong one.`);
  }
  return { app, bundle: id };
}

/**
 * The capture flags with `--app` checked and resolved, before anything builds or boots. `--app <path.app>` installs
 * an app an earlier run built (`--build ... --app-out <file>` writes its path), so a set of captures builds once; its
 * bundle id fills `--bundle` when that is left out. Refused with `--build` (one or the other) and outside `--states`
 * (the other modes shoot what is already on the device). `--app-out` needs `--build` and a file. Flags with neither
 * come back unchanged.
 */
export function withPrebuiltApp(flags) {
  const out = flags['app-out'];
  if (out !== undefined) {
    if (flags.build === undefined) throw new Error('--app-out <file> writes where --build put the app, so it needs --build.');
    if (typeof out !== 'string' || !out.trim()) throw new Error('--app-out needs a file (for example --app-out build/app-path.txt).');
  }
  if (flags.app === undefined) return flags;
  if (flags.build !== undefined) {
    throw new Error('--app installs an app that is already built: drop --build (or drop --app to build in this run).');
  }
  if (!flags.states) throw new Error('--app installs the app for a --states capture; the other modes shoot what is already on the device.');
  return { ...flags, ...prebuiltApp(flags.app, flags.bundle) };
}

/** Print where `--build` put the app, and write that path and a newline to `--app-out <file>` when asked. */
export function recordBuiltApp(app, flags, log = console.log) {
  log(`▸ app: ${app}`);
  const file = flags['app-out'];
  if (typeof file !== 'string' || !file.trim()) return;
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${app}\n`);
  log(`  (its path is in ${target}; pass it on with --app)`);
}

/**
 * For a script that drives the app itself: find the simulator as `capture` does (`udid`, else `device`, else the
 * booted one, else the default device, created if missing), boot it only when it is not running, and install `app`
 * (an already-built .app; its bundle id is read from it and checked against `bundle`). Returns the teardown receipt
 * `{ udid, booted, created, bundle }` for `closeIosSim`, which shuts down only a simulator this call booted.
 */
export function openIosSim({ udid, device, app, bundle } = {}) {
  const built = app !== undefined ? prebuiltApp(app, bundle) : null; // refused before anything boots
  const sim = resolveIosSim({ udid, device });
  if (sim.booted) {
    sh('xcrun', ['simctl', 'boot', sim.udid]);
    sh('xcrun', ['simctl', 'bootstatus', sim.udid, '-b']);
  }
  if (built) sh('xcrun', ['simctl', 'install', sim.udid, built.app]);
  return { ...sim, bundle: built?.bundle ?? bundle ?? null };
}

/**
 * Undo `openIosSim`: shut down the simulator only if it booted it (and delete a device it created). One that was
 * already running is left as it was; `keep` leaves this one up too. Returns whether it shut anything down.
 */
export function closeIosSim(sim, { keep = false } = {}) {
  if (!sim?.udid || keep || !sim.booted) return false;
  spawnSync('xcrun', ['simctl', 'shutdown', sim.udid], { stdio: 'ignore' });
  if (sim.created) spawnSync('xcrun', ['simctl', 'delete', sim.udid], { stdio: 'ignore' });
  return true;
}

/** `[{ name, udid }]` for every simulator `simctl list devices booted` prints. */
export function bootedSims(list) {
  const sims = [];
  for (const line of list.split('\n')) {
    const m = line.match(/^\s+(.+?) \(([0-9A-Fa-f-]{36})\) \(Booted\)/);
    if (m) sims.push({ name: m[1], udid: m[2] });
  }
  return sims;
}

/**
 * The Simulator app's window for the device named `name`, or null. The app titles a device window
 * "<name> – <runtime>", so the name must be followed by the separator, not by more name: "iPhone 18 Pro" is a
 * prefix of "iPhone 18 Pro Max".
 */
export function simulatorWindowFor(windows, name) {
  return windows.find((w) => w === name || [' – ', ' - ', ' — '].some((sep) => w.startsWith(name + sep))) ?? null;
}

/**
 * Raise the device's own window in the Simulator app (Xcode 26 and before), so its Device ▸ Orientation menu, which
 * acts on the window in front, turns THIS simulator and not another one that is booted beside it. Best effort: when
 * no window carries the device's name it does nothing and says so, and the proven turn catches a turn that went
 * astray. Returns the window raised, or null.
 */
export function raiseSimulatorWindow(udid, log = console.log) {
  const name = bootedSims(out2('xcrun', ['simctl', 'list', 'devices', 'booted'])).find((s) => s.udid === udid)?.name;
  const r = spawnSync('osascript', ['-e', 'tell application "System Events" to tell process "Simulator" to get name of every window'],
    { encoding: 'utf8' });
  const windows = r.status === 0 ? r.stdout.trim().split(', ').filter(Boolean) : [];
  const window = name ? simulatorWindowFor(windows, name) : null;
  if (!window) {
    if (windows.length > 1) log(`  (no Simulator window is named for ${name || udid}; the turn goes to the window in front)`);
    return null;
  }
  const quoted = window.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  spawnSync('osascript', ['-e', `tell application "System Events" to tell process "Simulator" to perform action "AXRaise" of (first window whose name is "${quoted}")`],
    { stdio: 'ignore' });
  return window;
}

/** What a turn that did not happen is reported as. `others`: the names of the other simulators booted at the time. */
export function notTurnedMessage(orientation, others = []) {
  return `the simulator did not turn — still portrait after asking for ${orientation} twice.\n`
    + '  The usual cause is the APP, not the tooling: iOS refuses an orientation the Info.plist does\n'
    + '  not list, and on iPad the key it reads is UISupportedInterfaceOrientations~ipad.'
    + (others.length
      ? `\n  Also booted: ${others.join(', ')}. Through the Simulator app's menu (Xcode 26 and before) a turn goes to the`
        + '\n  window in front; zdymak raises this device\'s window first, which needs a window titled with its name.'
      : '');
}

/**
 * Turn a simulator and PROVE it turned, asking twice before it fails. From portrait (`toPortrait`), a frame, the turn
 * (`toTarget`), a frame: two orientations of a real screen never match byte for byte, so equal frames mean the device
 * stayed where it was. A turn asked for while a simulator is still finishing its boot can be dropped, so an unchanged
 * frame is asked for once more, from portrait again, before it is an error. `frame()` settles and returns the
 * framebuffer; `others()` names the other booted simulators for the error. Returns the ask that took (1 or 2).
 */
export async function provenTurn({ orientation, toPortrait, toTarget, frame, log = console.log, others = () => [] }) {
  for (let ask = 1; ask <= 2; ask++) {
    await toPortrait();
    const before = await frame();
    await toTarget();
    if (!before.equals(await frame())) return ask;
    if (ask === 1) log(`  ↻ still portrait after asking for ${orientation}; asking once more`);
  }
  throw new Error(notTurnedMessage(orientation, others()));
}
