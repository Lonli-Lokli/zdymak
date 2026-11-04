// Which iOS simulator a capture runs on, and whether the capture boots it (and so shuts it down at teardown).
// Kept apart from index.mjs so it can be tested with a stand-in `xcrun` on PATH:
//   node --test scripts/simulator.test.mjs
import { spawnSync } from 'node:child_process';

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
