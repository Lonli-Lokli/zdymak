/**
 * An Android foldable's postures and a device's turn, set over adb.
 *
 * The emulator's foldable profiles (a book-style fold and a flip) take the hinge from the emulator
 * console, `adb emu sensor set hinge-angle0 <degrees>`, and the system reads its posture from that angle
 * into a device state, which `cmd device_state print-state` reports (Android 14+). The state is the check
 * that the posture took: its id is matched to its NAME through `print-states`, because the ids differ by
 * profile (a book fold numbers CLOSED 0, a flip 1). A real phone has no console to set its hinge, so
 * --posture there is refused with that reason rather than shot as whatever it happens to be.
 *
 * A closed book fold shows its outer screen and reports a new size; a flip's emulator profile keeps one
 * display, so closed is the cover posture only where the profile draws one.
 *
 * The turn is the user rotation with auto-rotate off, and "portrait"/"landscape" are read against the
 * screen's own size after the posture is set: a 7in tablet is wide at rotation 0 and a phone is tall,
 * so the same word asks for a different rotation on each. Everything is put back as it was found.
 */
import { spawnSync } from 'node:child_process';

/** Each posture: the hinge angle the console is given and the device state the system must report. */
export const ANDROID_POSTURES = {
  closed: { hinge: 0, state: 'CLOSED' },
  'half-open': { hinge: 90, state: 'HALF_OPENED' },
  open: { hinge: 180, state: 'OPENED' },
};

/** The posture a flag names, with `--hinge` overriding the half-open angle. Throws on an unknown name. */
export function androidPostureOf(name, hinge) {
  const key = String(name).toLowerCase();
  const p = ANDROID_POSTURES[key];
  if (!p) throw new Error(`--posture on Android must be one of: ${Object.keys(ANDROID_POSTURES).join(', ')} (got "${name}").`);
  if (hinge === undefined || key !== 'half-open') return { name: key, ...p };
  const angle = Number(hinge);
  if (!(angle > 0 && angle < 180)) throw new Error(`--hinge must be between 0 and 180 degrees, exclusive, for half-open (got ${hinge}).`);
  return { name: key, ...p, hinge: angle };
}

/** `print-states` → Map of id to name, from `DeviceState{identifier=0, name='CLOSED', …}`. */
export function parseDeviceStates(out) {
  const states = new Map();
  for (const m of String(out).matchAll(/identifier=(\d+),\s*name='([^']+)'/g)) states.set(Number(m[1]), m[2]);
  return states;
}

/** `print-state` → the current state's id, or null. The output is the id alone, or `DeviceState{identifier=…}`. */
export function parseCurrentState(out) {
  const s = String(out).trim();
  const m = /identifier=(\d+)/.exec(s) || /^(\d+)\b/.exec(s);
  return m ? Number(m[1]) : null;
}

/** `emu sensor get hinge-angle0` → the angle, or null when the console has no hinge (`hinge-angle0 = 180` + `OK`). */
export function parseHinge(out) {
  const m = /hinge-angle0\s*=\s*(-?\d+(?:\.\d+)?)/.exec(String(out));
  return m ? Number(m[1]) : null;
}

/** `wm size` → the size in use: the override when there is one, else the physical size. */
export function parseWmSize(out) {
  const s = String(out);
  const m = /Override size:\s*(\d+)x(\d+)/.exec(s) || /Physical size:\s*(\d+)x(\d+)/.exec(s);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
}

/**
 * The user rotation (0–3) that shows `orientation` on a screen whose rotation-0 size is `natural`.
 * Portrait is the first quarter turn that is tall, landscape the first that is wide.
 */
export function rotationFor(orientation, natural) {
  const o = String(orientation).toLowerCase();
  if (o !== 'portrait' && o !== 'landscape') throw new Error(`--orientation on Android must be portrait or landscape (got "${orientation}").`);
  const wideAtZero = natural.w > natural.h;
  return (o === 'landscape') === wideAtZero ? 0 : 1;
}

/** Whether a shot of `w`×`h` has the orientation asked for. A square screen has either. */
export function shapeMatches(orientation, w, h) {
  if (w === h) return true;
  return (orientation === 'landscape') === (w > h);
}

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
/** The wall clock and a blocking sleep: what the waits below run on, and a test replaces. */
const WALL_CLOCK = { now: () => Date.now(), sleep: pause };

function adbRunner(serial) {
  const pre = serial ? ['-s', serial] : [];
  const run = (...args) => {
    const r = spawnSync('adb', [...pre, ...args], { encoding: 'utf8' });
    return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.replace(/\r/g, '') };
  };
  return { run, shell: (...args) => run('shell', ...args), emu: (...args) => run('emu', ...args) };
}

/** The device state's name now, or null when the device has no device_state service. */
function stateName(adb) {
  const names = parseDeviceStates(adb.shell('cmd', 'device_state', 'print-states').out);
  const id = parseCurrentState(adb.shell('cmd', 'device_state', 'print-state').out);
  return id === null ? null : names.get(id) ?? `state ${id}`;
}

/**
 * Fold the emulator into `posture` and wait (up to `maxMs`) for the system to report its state.
 * Returns the angle it was at, for `leaveAndroidPosture`. Throws when there is no hinge to set or the
 * state never comes, naming what the device read instead. `adb` and `clock` are the device and the time it
 * waits on, given by a test.
 */
export function enterAndroidPosture(posture, { serial, maxMs = 10000, adb = adbRunner(serial), clock = WALL_CLOCK } = {}) {
  const previous = parseHinge(adb.emu('sensor', 'get', 'hinge-angle0').out);
  if (previous === null) {
    throw new Error('--posture on Android needs a foldable EMULATOR: its console sets the hinge (adb emu sensor set hinge-angle0), '
      + 'and this device has no hinge sensor there. A real phone is folded by hand and shot with --name.');
  }
  const set = adb.emu('sensor', 'set', 'hinge-angle0', String(posture.hinge));
  if (!set.ok) throw new Error(`the emulator console refused hinge-angle0 = ${posture.hinge}: ${set.out.trim()}`);
  const until = clock.now() + maxMs;
  let read = null;
  while (clock.now() < until) {
    read = stateName(adb);
    if (read === posture.state) return { previous };
    clock.sleep(400);
  }
  adb.emu('sensor', 'set', 'hinge-angle0', String(previous));
  throw new Error(`${posture.name} wants the device state ${posture.state} at a hinge of ${posture.hinge}°, and the device reports ${read ?? 'no device state (Android 14+ reports one)'}.`);
}

/** Put the hinge back where `enterAndroidPosture` found it. */
export function leaveAndroidPosture(entered, { serial } = {}) {
  if (!entered || entered.previous === null) return;
  adbRunner(serial).emu('sensor', 'set', 'hinge-angle0', String(entered.previous));
}

/**
 * Turn the screen to `orientation` with auto-rotate off. Returns a `reset()` that puts both settings back.
 * The rotation-0 size is read now, after any posture, since a closed book fold has a screen of its own.
 */
export function turnAndroid(orientation, { serial } = {}) {
  const adb = adbRunner(serial);
  const size = parseWmSize(adb.shell('wm', 'size').out);
  if (!size) throw new Error('--orientation could not read the screen size (adb shell wm size).');
  const current = Number(adb.shell('settings', 'get', 'system', 'user_rotation').out.trim()) || 0;
  // `wm size` reports the rotation-0 size, whatever the screen is turned to now.
  const rotation = rotationFor(orientation, size);
  const auto = adb.shell('settings', 'get', 'system', 'accelerometer_rotation').out.trim();
  adb.shell('settings', 'put', 'system', 'accelerometer_rotation', '0');
  adb.shell('settings', 'put', 'system', 'user_rotation', String(rotation));
  return {
    rotation,
    reset() {
      adb.shell('settings', 'put', 'system', 'user_rotation', String(current));
      if (/^[01]$/.test(auto)) adb.shell('settings', 'put', 'system', 'accelerometer_rotation', auto);
    },
  };
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * The PNG in `adb exec-out screencap -p`'s output, and any text before it. On a device with more than one display
 * (a book fold, a desktop-sized emulator) screencap writes a warning to stdout ahead of the picture, so the file
 * is not a PNG until it is cut at the signature. Throws, with the text, when there is no picture at all.
 */
export function pngFromScreencap(buf) {
  const at = buf.indexOf(PNG_SIGNATURE);
  if (at < 0) throw new Error(`adb screencap returned no PNG: ${buf.subarray(0, 300).toString('utf8').trim()}`);
  return { png: buf.subarray(at), note: at > 0 ? buf.subarray(0, at).toString('utf8').trim() : null };
}
