// What a project reaches through the package's own name, as a consumer's import does (the package resolves
// itself through `exports`): a script that drives a simulator itself needs the fold helpers beside openIosSim,
// and a path into src/ is refused by the exports map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as zdymak from 'zdymak';
import * as fold from '../src/capture/fold.mjs';

test('the package exports the simulator and fold helpers a script drives the iPhone Duo with', () => {
  for (const name of ['openIosSim', 'closeIosSim', 'postureOf', 'enterPosture', 'leavePosture', 'shootPosture']) {
    assert.equal(typeof zdymak[name], 'function', `zdymak does not export ${name}`);
  }
  for (const name of ['postureOf', 'enterPosture', 'leavePosture', 'shootPosture']) {
    assert.equal(zdymak[name], fold[name], `zdymak's ${name} is not the fold helper`);
  }
  assert.deepEqual(zdymak.POSTURES, fold.POSTURES);
  assert.equal(zdymak.postureOf('half-laptop', '95').hinge, 95);
});

test('a path into src/ is not part of the package', async () => {
  await assert.rejects(import('zdymak/src/capture/fold.mjs'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
});
