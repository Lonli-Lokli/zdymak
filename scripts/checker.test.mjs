// The checker's rules on what a device and a picture say, without a device or a text reader.
//   node --test scripts/checker.test.mjs        (or: npm run check:checker)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  factRefusals, parseAndroidFocus, parseAppLocales, parseIosRunning, parseKeyboardShown, scriptOf, textRefusals,
} from '../src/checker.mjs';

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
