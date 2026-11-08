// The checker's rules on what a device and a picture say, without a device or a text reader.
//   node --test scripts/checker.test.mjs        (or: npm run check:checker)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import {
  MOTION_STILL, checkSet, checkShot, factRefusals, letterboxOf, motionAllowance, parseAndroidFocus, parseAndroidOverlays,
  parseAppLocales, parseIosRunning, parseKeyboardShown, scriptOf, textRefusals,
} from '../src/checker.mjs';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

const rules = (list) => list.map((r) => r.rule).sort();
const android = (over) => ({ platform: 'android', app: 'com.example.app', language: 'en-US', time: '9:41', focus: { window: 'com.example.app/com.example.app.Main', app: 'com.example.app' }, keyboard: false, appLocales: ['en-US'], systemLocale: 'en-US', demoAllowed: true, ...over });
const line = (text, y = 0.5, h = 0.02) => ({ text, conf: 1, x: 0.1, y, w: 0.5, h });

test('the focused window and app are read from dumpsys window', () => {
  const dump = '  mCurrentFocus=Window{1a2b3c u0 Application Not Responding: com.android.systemui}\n'
    + '  mFocusedApp=ActivityRecord{4d5e u0 com.example.app/.Main t12}\n';
  assert.deepEqual(parseAndroidFocus(dump), { window: 'Application Not Responding: com.android.systemui', app: 'com.example.app' });
  assert.deepEqual(parseAndroidFocus('mCurrentFocus=null'), { window: null, app: null });
});

test('the keyboard, the app locales and an iOS app running are read from their dumps', () => {
  assert.equal(parseKeyboardShown('  mInputShown=true mShowRequested=true'), true);
  assert.equal(parseKeyboardShown('  mInputShown=false'), false);
  assert.deepEqual(parseAppLocales('Locales for com.example.app for user 0 are [fr-FR]'), ['fr-FR']);
  assert.deepEqual(parseAppLocales('Locales for com.example.app for user 0 are []'), []);
  const list = 'PID\tStatus\tLabel\n4242\t0\tUIKitApplication:com.example.app[a1b2][rb-legacy]\n';
  assert.equal(parseIosRunning(list, 'com.example.app'), true);
  assert.equal(parseIosRunning('-\t0\tUIKitApplication:com.example.app[a1b2]\n', 'com.example.app'), false);
  assert.equal(parseIosRunning('PID\tStatus\tLabel\n', 'com.example.app'), false);
});

test('Android\'s compatibility UI is read from the surface list, where a focus dump never shows it', () => {
  // As `dumpsys SurfaceFlinger --list` names layers: the app's window keeps the focus while the dialog's leash is up.
  const list = 'Display 0 name="Built-in Screen"#0\n'
    + 'Task=12#81\n'
    + 'com.example.app/com.example.app.Main#97\n'
    + 'LetterboxEduWindowManagerLeash#131\n'
    + 'LetterboxEduWindowManager12#132\n'
    + 'StatusBar#40\n';
  assert.deepEqual(parseAndroidOverlays(list), ['LetterboxEduWindowManager']);
  assert.deepEqual(parseAndroidOverlays('RestartDialogWindowManagerLeash#5\nReachabilityEduWindowManagerLeash#6\n'), ['RestartDialogWindowManager', 'ReachabilityEduWindowManager']);
  assert.deepEqual(parseAndroidOverlays('com.example.app/com.example.app.Main#97\nStatusBar#40\n'), []);
  assert.deepEqual(parseAndroidOverlays(''), []);
});

test('the device refuses Android\'s letterbox education dialog while the app keeps the focus', () => {
  // The facts one store run kept for a shot with the dialog over it: the app had the focus, so nothing was refused.
  const got = factRefusals(android({ overlays: ['LetterboxEduWindowManager'] }));
  assert.deepEqual(rules(got), ['dialog']);
  assert.match(got[0].reason, /letterbox education dialog/);
  assert.deepEqual(rules(factRefusals(android({ overlays: ['RestartDialogWindowManager'] }))), ['dialog']);
  assert.deepEqual(factRefusals(android({ overlays: [] })), []);
});

test('a clean Android shot carries no refusal from the device', () => {
  assert.deepEqual(factRefusals(android({})), []);
});

test('the device refuses each system dialog, the keyboard, the home screen, another app, the bar and the language', () => {
  const cases = [
    [{ focus: { window: 'Application Not Responding: com.android.systemui' } }, 'dialog', /System UI isn't responding/],
    [{ focus: { window: 'Application Not Responding: com.example.app' } }, 'dialog', /isn't responding/],
    [{ focus: { window: 'Application Error: com.example.app' } }, 'dialog', /crash dialog/],
    [{ focus: { window: 'com.google.android.permissioncontroller/com.android.permissioncontroller.permission.ui.GrantPermissionsActivity' } }, 'dialog', /permission prompt/],
    [{ keyboard: true }, 'keyboard', /keyboard/],
    [{ focus: { window: 'com.google.android.apps.nexuslauncher/.NexusLauncherActivity' } }, 'wrong-app', /home screen/],
    [{ focus: { window: 'com.android.chrome/.Main' } }, 'wrong-app', /com\.android\.chrome is in front/],
    [{ demoAllowed: false }, 'status-bar', /demo mode/],
    [{ language: 'fr-FR', appLocales: ['en-US'] }, 'language', /app is in en-US, the set is fr-FR/],
    [{ launchDifference: 0.01, launchLook: 0.04 }, 'launch', /launch screen/],
  ];
  for (const [over, rule, reason] of cases) {
    const got = factRefusals(android(over));
    assert.deepEqual(rules(got), [rule], JSON.stringify(over));
    assert.match(got[0].reason, reason);
  }
});

test('iOS: the app not running, and a status bar without the override', () => {
  const ios = { platform: 'ios', app: 'com.example.app', time: '9:41', running: true, statusBar: 'Current status bar overrides:\n  Time: 9:41\n' };
  assert.deepEqual(factRefusals(ios), []);
  assert.deepEqual(rules(factRefusals({ ...ios, running: false })), ['wrong-app']);
  assert.deepEqual(rules(factRefusals({ ...ios, statusBar: '' })), ['status-bar']);
});

test('the picture: dialogs, a keyboard, a home screen, the real clock and battery', () => {
  const one = (lines, opts) => rules(textRefusals(lines, opts));
  assert.deepEqual(one([line('System UI isn’t responding')]), ['dialog']);
  assert.deepEqual(one([line('Example keeps stopping')]), ['dialog']);
  assert.deepEqual(one([line('Allow Example to send you notifications?'), line('Don’t allow', 0.6)]), ['dialog']);
  assert.deepEqual(one([line('“Example” Would Like to Send You Notifications')]), ['dialog']);
  // Android's letterbox education and restart dialogs, in AOSP's words.
  assert.deepEqual(one([line('See and do more', 0.4), line('Got it', 0.7)]), ['dialog']);
  assert.deepEqual(one([line('Double-tap outside an app to reposition it')]), ['dialog']);
  assert.deepEqual(one([line('Restart for a better view?')]), ['dialog']);
  assert.deepEqual(one([line('Q W E R T Y U I O P', 0.75)]), ['keyboard']);
  assert.deepEqual(one([line('Й Ц У К Е Н Г Ш Щ З Х', 0.75)]), ['keyboard']);
  assert.deepEqual(one([line('QWERTYUIOP', 0.2)]), [], 'a row of letters high on the screen is the app, not a keyboard');
  assert.deepEqual(one([line('Settings'), line('Photos'), line('Camera'), line('Clock')]), ['wrong-app']);
  assert.deepEqual(one([line('14:07', 0.01)]), ['status-bar']);
  assert.deepEqual(one([line('9:41', 0.01), line('87%', 0.01)]), ['status-bar']);
  assert.deepEqual(one([line('9:41', 0.01), line('100%', 0.01)]), []);
  assert.deepEqual(one([line('09:41', 0.01)]), [], 'Android pins 09:41');
  assert.deepEqual(one([line('Score 14:07', 0.5)]), [], 'a time in the app is not the status bar');
});

test('the picture: words in another script than the set, and English on a Latin set', () => {
  const english = [line('Tap a cell to open it, and flag the mines with your second finger')];
  assert.equal(scriptOf('ru-RU'), 'Cyrillic');
  assert.equal(scriptOf('ja'), 'Japanese');
  assert.equal(scriptOf('pt-BR'), 'Latin');
  assert.deepEqual(rules(textRefusals(english, { language: 'ru' })), ['language']);
  assert.deepEqual(rules(textRefusals(english, { language: 'fr-FR' })), ['language']);
  assert.deepEqual(rules(textRefusals(english, { language: 'en-US' })), []);
  assert.deepEqual(rules(textRefusals([line('Нажмите на клетку, чтобы открыть её, и отметьте мины')], { language: 'uk' })), []);
  assert.deepEqual(rules(textRefusals([line('Touchez une case pour l’ouvrir et marquez les mines')], { language: 'fr' })), []);
  assert.deepEqual(rules(textRefusals(english, { language: 'hi' })), [], 'Vision does not read Devanagari: no verdict from the picture');
  assert.deepEqual(rules(textRefusals([line('OK')], { language: 'ru' })), [], 'too few letters for a verdict');
});

test('the device: a screen still changing past the scene\'s allowance', () => {
  assert.deepEqual(factRefusals(android({ motion: MOTION_STILL / 2 })), []);
  assert.deepEqual(rules(factRefusals(android({ motion: 0.05 }))), ['motion']);
  assert.deepEqual(factRefusals(android({ motion: 0.05, motionAllowed: 0.2 })), []);
  assert.equal(motionAllowance(undefined, 'home'), MOTION_STILL);
  assert.equal(motionAllowance('0.05', 'home'), 0.05);
  assert.equal(motionAllowance('clock=0.2,0.03', 'clock'), 0.2);
  assert.equal(motionAllowance('clock=0.2,0.03', 'home'), 0.03);
  assert.equal(motionAllowance('clock=0.2', 'home'), MOTION_STILL);
  assert.throws(() => motionAllowance('clock=lots', 'clock'), /--motion/);
});

/** RGBA pixels: `paint(x, y)` gives [r, g, b]. */
const pixels = (width, height, paint) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const i = (y * width + x) * 4; [data[i], data[i + 1], data[i + 2]] = paint(x, y); data[i + 3] = 255; }
  return { data, width, height };
};
const busy = (x, y) => [x % 251, y % 241, (x * y) % 239];

test('the picture: letterbox bars, and the layouts that are not', () => {
  // A phone-shaped app in the middle of a landscape tablet, black either side.
  const pillar = pixels(400, 300, (x, y) => (x >= 130 && x < 270 ? busy(x, y) : [0, 0, 0]));
  assert.equal(letterboxOf(pillar)?.sides, 'left and right');
  // A phone on its side in a portrait tablet, with the status strip drawn across the top bar.
  const sideways = pixels(300, 400, (x, y) => (y < 10 ? busy(x, y) : y >= 130 && y < 270 ? busy(x, y) : [40, 40, 40]));
  assert.equal(letterboxOf(sideways)?.sides, 'top and bottom');
  // A readable-width column on a plain ground is wider than a phone; a phone's own shot with plain margins is phone-shaped.
  assert.equal(letterboxOf(pixels(400, 300, (x, y) => (x >= 80 && x < 320 ? busy(x, y) : [240, 240, 230]))), null);
  assert.equal(letterboxOf(pixels(180, 390, (x, y) => (x >= 20 && x < 160 ? busy(x, y) : [240, 240, 230]))), null);
  // Bars of two colours are the app's own design, not the system's letterbox.
  assert.equal(letterboxOf(pixels(400, 300, (x, y) => (x < 130 ? [0, 0, 0] : x >= 270 ? [200, 0, 0] : busy(x, y)))), null);
  // Nothing at all is blank's to refuse, not a letterbox.
  assert.equal(letterboxOf(pixels(400, 300, () => [0, 0, 0])), null);
});

/** `px` written as a PNG in a fresh folder, for checkShot, which reads a file. */
const pngOf = (px, name) => {
  const c = createCanvas(px.width, px.height);
  const g = c.getContext('2d');
  const img = g.createImageData(px.width, px.height);
  img.data.set(px.data);
  g.putImageData(img, 0, 0);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zdymak-checker-')), `${name}.png`);
  fs.writeFileSync(file, c.toBuffer('image/png'));
  return file;
};
/**
 * A shot with plain rows of `colour` above and below an app's busy content: `top` and `bottom` rows each, the status
 * strip's own rows included, with the clock drawn in the strip.
 */
const margins = (width, height, top, bottom, colour) => pixels(width, height, (x, y) => {
  if (y < 30 && x > 40 && x < 160) return busy(x, y); // the clock, inside the status strip
  return y < top || y >= height - bottom ? colour : busy(x, y);
});
const iosFactsOn = (screen) => ({ platform: 'ios', app: 'com.example.app', language: 'en', time: '9:41', running: true, statusBar: 'Time: 09:41\n', motion: 0, ...(screen ? { screen } : {}) });

test('a phone turned on its side is never letterboxed: its own margins and a scrim around a card are not bars', async () => {
  // A folding iPhone closed and turned, 2034x1398 (1.455 wide), with the bars a store run measured on three of its
  // shots: page margins above a stacked layout's header and below its tray, light and dark, and a dimmed scrim
  // around a centred result card. The system never letterboxes an app on a phone, whatever the bars look like.
  const shots = {
    'margins-dark': margins(2034, 1398, 100, 138, [16, 19, 30]),
    'margins-light': margins(2034, 1398, 100, 158, [246, 241, 243]),
    'scrim-card': margins(2034, 1398, 88, 88, [11, 26, 15]),
  };
  for (const [name, px] of Object.entries(shots)) {
    assert.ok(letterboxOf(px), `${name}: the picture alone reads as bars, so only the device can tell`);
    const r = await checkShot(pngOf(px, name), { facts: iosFactsOn('phone'), text: false });
    assert.deepEqual(rules(r.refusals), [], name);
  }
});

test('a large screen keeps the letterbox check: an iPhone-only app on an iPad, and a shot whose screen is not known', async () => {
  // An iPhone-only app turned on an iPad held landscape (4:3, here at half the 13in's 2752x2064): black bars above
  // and below a 19.5:9 box.
  const ipad = margins(1376, 1032, 198, 198, [0, 0, 0]);
  const large = await checkShot(pngOf(ipad, 'ipad-landscape'), { facts: iosFactsOn('large'), text: false });
  assert.deepEqual(rules(large.refusals), ['letterbox']);
  // Facts kept before the device's screen was recorded: the picture's shape decides, as it always did.
  const duo = margins(2034, 1398, 100, 138, [16, 19, 30]);
  const unknown = await checkShot(pngOf(duo, 'unknown-screen'), { facts: iosFactsOn(null), text: false });
  assert.deepEqual(rules(unknown.refusals), ['letterbox']);
});

test('the bad-shot fixtures: each is refused for its own rule, shot by shot, and nothing else', async () => {
  const dir = path.join(fixtures, 'bad-shots');
  const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
  assert.deepEqual(files, Object.keys(expected).sort(), 'every fixture has its expected rule');
  const results = [];
  for (const f of files) results.push(await checkShot(path.join(dir, f), { text: false }));
  await checkSet(results);
  for (const r of results) assert.deepEqual(rules(r.refusals), expected[path.basename(r.file)], path.basename(r.file));
  const covered = new Set(Object.values(expected).flat());
  for (const rule of ['unreadable', 'blank', 'launch', 'motion', 'dialog', 'keyboard', 'wrong-app', 'status-bar', 'language', 'letterbox', 'duplicate']) {
    assert.ok(covered.has(rule), `a fixture for ${rule}`);
  }
});

test('the good-shot fixtures: no rule refuses them', async () => {
  const dir = path.join(fixtures, 'good-shots');
  const results = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.png'))) results.push(await checkShot(path.join(dir, f), { text: false }));
  await checkSet(results);
  assert.ok(results.length >= 4);
  for (const r of results) assert.deepEqual(r.refusals, [], path.basename(r.file));
});
