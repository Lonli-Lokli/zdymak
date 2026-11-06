import assert from 'node:assert/strict';
import { test } from 'node:test';
import { androidDemoNetwork } from '../src/capture/index.mjs';

const slots = (cmds) => Object.fromEntries(cmds.map((c) => [c[4], c[5]]));
const validated = (cmds) => cmds.filter((c) => c[5] === 'show').every((c) => c.join(' ').includes('fully true'));

test('from API 36 wifi alone carries the connected read: the demo mobile icon is drawn untinted there', () => {
  for (const sdk of [36, 37]) {
    const cmds = androidDemoNetwork(sdk);
    assert.deepEqual(slots(cmds), { mobile: 'hide', wifi: 'show' });
    assert.ok(validated(cmds));
  }
});

test('below API 36 the mobile bars carry it and wifi is hidden unless asked for (API 34 draws it twice)', () => {
  assert.deepEqual(slots(androidDemoNetwork(34)), { wifi: 'hide', mobile: 'show' });
  assert.deepEqual(slots(androidDemoNetwork(34, { wifi: true })), { wifi: 'show', mobile: 'show' });
  assert.ok(validated(androidDemoNetwork(34, { wifi: true })));
});

test('an unread API level keeps the older bar', () => {
  assert.deepEqual(slots(androidDemoNetwork(Number.NaN)), { wifi: 'hide', mobile: 'show' });
});
