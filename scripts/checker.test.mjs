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
  MOTION_STILL, STATUS_STRIP_FALLBACK, androidScreen, checkSet, checkShot, factRefusals, iosScreen, letterboxOf, motionAllowance,
  parseAndroidFocus, parseAndroidOverlays, parseAppLocales, parseIosDeviceType, parseIosRunning, parseKeyboardShown, parseStatusInset,
  parseIosStatusTime, parseWmDensity, scriptOf, statusStripOf, textRefusals,
} from '../src/checker.mjs';
import { STATUS_BAR_KEPT, iosStatusBarOf } from '../src/checker-device.mjs';

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

test('iOS: the status bar override\'s time is read from either listing form, and the listing is kept as printed', () => {
  // The two forms `simctl status_bar <udid> list` is said to print across Xcode versions; tonight's capture keeps the
  // pinned Xcode's own listing in the facts (statusBar), where its real form can be read.
  const colon = 'Current Status Bar Overrides:\n=============================\nTime: 9:41\nDataNetworkType: wifi\nBatteryLevel: 100\n';
  const equals = 'Current status bar overrides:\n  time=9:41 dataNetwork=wifi batteryState=charged batteryLevel=100\n';
  assert.equal(parseIosStatusTime(colon), '9:41');
  assert.equal(parseIosStatusTime(equals), '9:41');
  assert.equal(parseIosStatusTime('Current Status Bar Overrides:\n=============================\n'), null);
  const ios = { platform: 'ios', app: 'com.example.app', time: '9:41', running: true };
  for (const statusBar of [colon, equals, colon.replace('9:41', '09:41')]) assert.deepEqual(factRefusals({ ...ios, statusBar }), [], statusBar);
  for (const statusBar of [colon.replace('9:41', '19:41'), equals.replace('9:41', '10:30'), 'Current Status Bar Overrides:\n']) {
    assert.deepEqual(rules(factRefusals({ ...ios, statusBar })), ['status-bar'], statusBar);
  }
  assert.equal(iosStatusBarOf({ status: 0, stdout: colon }), colon);
  assert.equal(iosStatusBarOf({ status: 0, stdout: 'x'.repeat(STATUS_BAR_KEPT * 3) }).length, STATUS_BAR_KEPT);
  assert.equal(iosStatusBarOf({ status: 1, stdout: '' }), null);
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

test('the status strip is the status bar\'s own inset where the facts know it, so a timer or a score just under it is the app\'s', () => {
  // A 1080x2400 phone whose status bar is 63 px tall, with a timer and a score drawn 47 to 77 px under it: inside the
  // 6% fallback strip (144 px), where they read as a clock that is not 9:41 and a battery that is not full.
  const px = (y, h = 30) => [y / 2400, h / 2400];
  const hud = [line('1:23', ...px(110)), line('75%', ...px(120))];
  assert.deepEqual(rules(textRefusals(hud)), ['status-bar'], 'with no inset known, the fallback strip takes them');
  const strip = statusStripOf({ statusInset: 63 }, 2400);
  assert.equal(strip, 63 / 2400);
  assert.deepEqual(rules(textRefusals(hud, { strip })), [], 'under the bar, they are the app\'s');
  assert.deepEqual(rules(textRefusals([line('14:07', ...px(18)), ...hud], { strip })), ['status-bar'], 'the real clock in the bar is still refused');
  assert.equal(statusStripOf({}, 2400), STATUS_STRIP_FALLBACK);
  assert.equal(statusStripOf(null, 2400), STATUS_STRIP_FALLBACK);
  assert.equal(statusStripOf({ statusInset: 63 }, 0), STATUS_STRIP_FALLBACK, 'no height, no share');
});

test('the status bar\'s inset is read from dumpsys window, as Android prints its insets sources', () => {
  // Android 14 and later name the type; 12 and 13 print its old constant. The largest of the displays' bars is kept.
  const api34 = '    InsetsStateController\n      InsetsSource id=3b2e0005 type=statusBars frame=[0,0][1080,63] visible=true mFlags=[] mSideHint=TOP\n'
    + '      InsetsSource id=3b2e0001 type=navigationBars frame=[0,2337][1080,2400] visible=true mFlags=[] mSideHint=BOTTOM\n';
  assert.equal(parseStatusInset(api34), 63);
  assert.equal(parseStatusInset('        InsetsSource type=ITYPE_STATUS_BAR frame=[0,0][1080,136] visible=true\n'), 136);
  assert.equal(parseStatusInset(`${api34}      InsetsSource id=7 type=statusBars frame=[0,0][2208,118] visible=true\n`), 118);
  assert.equal(parseStatusInset('      InsetsSource id=3b2e0005 type=statusBars frame=[0,0][0,0] visible=false\n'), null);
  assert.equal(parseStatusInset('      InsetsSource id=3b2e0001 type=navigationBars frame=[0,2337][1080,2400] visible=true\n'), null);
  assert.equal(parseStatusInset(''), null);
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

test('the language rule reads a script subtag and Android\'s legacy language codes', () => {
  assert.equal(scriptOf('sr'), 'Cyrillic');
  assert.equal(scriptOf('sr-Latn'), 'Latin');
  assert.equal(scriptOf('sr-Latn-RS'), 'Latin');
  assert.equal(scriptOf('be-Latn'), 'Latin');
  assert.equal(scriptOf('uz-Cyrl'), 'Cyrillic');
  assert.equal(scriptOf('zh-Hant'), 'Han');
  assert.equal(scriptOf('zh-Hans-CN'), 'Han');
  assert.equal(scriptOf('sr_RS_#Latn'), 'Latin', 'Java\'s Locale.toString form');
  assert.equal(scriptOf('iw'), 'Hebrew');
  assert.equal(scriptOf('ji'), 'Hebrew');
  assert.equal(scriptOf('en-US'), 'Latin', 'a region is not a script');
  const latinSerbian = [line('Dodirnite polje da ga otvorite i obeležite mine drugim prstom')];
  assert.deepEqual(rules(textRefusals(latinSerbian, { language: 'sr-Latn' })), []);
  assert.deepEqual(rules(textRefusals(latinSerbian, { language: 'sr' })), ['language']);
  for (const [device, set] of [['iw-IL', 'he'], ['in', 'id-ID'], ['ji', 'yi'], ['he', 'iw']]) {
    assert.deepEqual(factRefusals(android({ language: set, appLocales: [device] })), [], `${device} is ${set}`);
  }
  assert.deepEqual(rules(factRefusals(android({ language: 'he', appLocales: ['in'] }))), ['language']);
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

test('the device\'s screen: a phone, or a large screen the system letterboxes on', () => {
  // `wm density` and `wm size`, as Android prints them, with and without an override.
  assert.equal(parseWmDensity('Physical density: 420\n'), 420);
  assert.equal(parseWmDensity('Physical density: 420\nOverride density: 160\n'), 160);
  assert.equal(parseWmDensity(''), null);
  assert.deepEqual(androidScreen({ w: 1080, h: 2400 }, 420), { smallestWidthDp: 411, screen: 'phone' });
  assert.deepEqual(androidScreen({ w: 1024, h: 600 }, 160), { smallestWidthDp: 600, screen: 'large' }, 'a 7in tablet');
  assert.deepEqual(androidScreen({ w: 1920, h: 1080 }, 160), { smallestWidthDp: 1080, screen: 'large' }, 'a Chromebook window');
  assert.deepEqual(androidScreen({ w: 2208, h: 1840 }, 420), { smallestWidthDp: 701, screen: 'large' }, 'a book fold open');
  assert.deepEqual(androidScreen({ w: 1080, h: 2092 }, 420), { smallestWidthDp: 411, screen: 'phone' }, 'a book fold closed');
  assert.deepEqual(androidScreen(null, 420), { smallestWidthDp: null, screen: null });
  // `simctl list devices -j`, cut to the fields read.
  const list = JSON.stringify({ devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-27-2': [
      { udid: 'A1', state: 'Shutdown', deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro-Max' },
      { udid: 'B2', state: 'Booted', deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M5-12GB' },
    ],
  } });
  assert.equal(parseIosDeviceType(list, 'A1'), 'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro-Max');
  assert.equal(parseIosDeviceType(list, 'booted'), 'com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M5-12GB');
  assert.equal(parseIosDeviceType(list, 'C3'), null);
  assert.equal(parseIosDeviceType('not json', 'A1'), null);
  const type = (model) => `com.apple.CoreSimulator.SimDeviceType.${model}`;
  assert.equal(iosScreen(type('iPad-Pro-13-inch-M5-12GB')), 'large');
  assert.equal(iosScreen(type('iPhone-18-Pro-Max')), 'phone');
  assert.equal(iosScreen(type('iPhone-Duo'), { screen: 'outer' }), 'phone', 'a folding iPhone closed, upright or turned');
  assert.equal(iosScreen(type('iPhone-Duo'), { screen: 'inner' }), 'large', 'a folding iPhone open');
  assert.equal(iosScreen(null), null);
});

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

test('a layout\'s reading column on a plain ground is not a letterbox where the density is known; a phone-sized box still is', async () => {
  // A Chromebook window, 1600x900 at density 160 (1 px a dp), with a 560dp column (a dialog's widest) centred on the
  // app's own plain ground: 900/560 is 1.61, phone-shaped by the picture's test alone, and 520 px of ground either side.
  const ground = [244, 241, 234];
  const column = pixels(1600, 900, (x, y) => (x >= 520 && x < 1080 ? busy(x, y) : ground));
  assert.ok(letterboxOf(column), 'the picture alone reads the ground as bars');
  assert.equal(letterboxOf(column, { pxPerDp: 1 }), null, 'a 560dp box is wider than any phone');
  const chromebook = android({ screen: 'large', smallestWidthDp: 900, density: 160, motion: 0 });
  assert.deepEqual(rules((await checkShot(pngOf(column, 'chromebook-column'), { facts: chromebook, text: false })).refusals), []);
  // Facts kept before the density was recorded still carry the smallest width, from which the density follows.
  const older = android({ screen: 'large', smallestWidthDp: 900, motion: 0 });
  assert.deepEqual(rules((await checkShot(pngOf(column, 'chromebook-column-older'), { facts: older, text: false })).refusals), []);
  // A phone-sized app boxed by the system on the same window: 411dp wide (a phone's width) between black bars.
  const boxed = pixels(1600, 900, (x, y) => (x >= 594 && x < 1005 ? busy(x, y) : [0, 0, 0]));
  assert.equal(letterboxOf(boxed, { pxPerDp: 1 })?.sides, 'left and right');
  assert.deepEqual(rules((await checkShot(pngOf(boxed, 'chromebook-boxed'), { facts: chromebook, text: false })).refusals), ['letterbox']);
  // The column's picture at density 320 (2 px a dp) is a 280dp box, phone-sized, so the density decides.
  assert.equal(letterboxOf(column, { pxPerDp: 2 })?.sides, 'left and right');
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

test('two postures of one size in one folder are not duplicates; two shots of one posture still are', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zdymak-postures-'));
  try {
    const src = path.join(fixtures, 'good-shots', 'scene-1.png');
    const facts = JSON.parse(fs.readFileSync(path.join(fixtures, 'bad-shots', '.zdymak-check', 'duplicate-1.json'), 'utf8'));
    const shots = [['title-open', 'open'], ['title-half-open', 'half-open'], ['title-open-again', 'open']];
    fs.mkdirSync(path.join(dir, '.zdymak-check'));
    for (const [name, posture] of shots) {
      fs.copyFileSync(src, path.join(dir, `${name}.png`));
      fs.writeFileSync(path.join(dir, '.zdymak-check', `${name}.json`), JSON.stringify({ ...facts, posture }));
    }
    const results = [];
    for (const [name] of shots) results.push(await checkShot(path.join(dir, `${name}.png`), { text: false }));
    await checkSet(results);
    assert.deepEqual(results.map((r) => rules(r.refusals)), [[], [], ['duplicate']]);
    assert.match(results[2].refusals[0].reason, /title-open\.png/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
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
