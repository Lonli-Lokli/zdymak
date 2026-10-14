// A scene that shows another scene's moment under its own id borrows that scene's caption (`captionOf`),
// in the source language and in every locale. Niva's Duo set rendered with no headline before it existed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.mjs';
import { localizeScenes, untranslatedScenes } from '../src/screenshots.mjs';

async function configWith(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zdymak-captions-'));
  const file = path.join(dir, 'zdymak.config.mjs');
  fs.writeFileSync(file, `export default ${JSON.stringify(body)};`);
  return loadConfig(file);
}

const shared = [
  { id: 'fresh', title: 'A daily field of logic.', sub: 'Everyone plays the same board.' },
  { id: 'midgame', title: 'Deduce, never guess.', sub: 'Every mine is findable.' },
];

test('a device scene with captionOf takes the shared scene\'s title and sub', async () => {
  const cfg = await configWith({
    scenes: shared,
    devices: { duo: { scenes: [
      { id: 'closed-fresh', image: './duo/fresh.png', captionOf: 'fresh' },
      { id: 'closed-midgame', image: './duo/midgame.png', captionOf: 'midgame', sub: 'Its own sub.' },
    ], screenshots: ['appstore-iphone-duo-outer'] } },
  });
  const [fresh, mid] = cfg.devices[0].scenes;
  assert.equal(fresh.title, 'A daily field of logic.');
  assert.equal(fresh.sub, 'Everyone plays the same board.');
  assert.equal(mid.title, 'Deduce, never guess.');
  assert.equal(mid.sub, 'Its own sub.', 'a sub of its own wins over the borrowed one');
  assert.equal(cfg.devices[0].scenesFor('de')[0].title, 'A daily field of logic.');
});

test('a locale translates a captionOf scene by the id it borrows from', () => {
  const table = { fresh: { title: 'Ein tägliches Feld der Logik.', sub: 'Alle spielen dasselbe Feld.' } };
  const scenes = [
    { id: 'closed-fresh', captionOf: 'fresh', title: 'A daily field of logic.', sub: 'x' },
    { id: 'closed-midgame', captionOf: 'midgame', title: 'Deduce, never guess.', sub: 'y' },
  ];
  const out = localizeScenes(scenes, table);
  assert.equal(out[0].title, 'Ein tägliches Feld der Logik.');
  assert.equal(out[0].sub, 'Alle spielen dasselbe Feld.');
  assert.equal(out[1].title, 'Deduce, never guess.', 'an untranslated one keeps the source caption');
  assert.deepEqual(untranslatedScenes(scenes, table), ['midgame']);
});

test('captionOf naming no shared scene fails at load, listing the ids there are', async () => {
  await assert.rejects(
    configWith({ scenes: shared, devices: { duo: { scenes: [{ id: 'x', image: './x.png', captionOf: 'frsh' }] } } }),
    /captionOf "frsh" names no top-level scene \(have: fresh, midgame\)/,
  );
});
