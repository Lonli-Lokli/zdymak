#!/usr/bin/env node
/**
 * Type-sync guard — the `.d.ts` sibling of `check-docs.mjs`.
 *
 * Every top-level config field (`CONFIG_KEYS`), every app-facing theme option (`PUBLIC_THEME_KEYS`) and
 * every store target id must appear as a declared member in `types/index.d.ts`. Adding a public knob
 * without typing it fails this check, so consumers' configs can't silently lose coverage as the tool
 * grows. Runs via `npm run check:types` (after `tsc --noEmit`) and on `prepublishOnly`.
 *
 *   node scripts/check-types.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_KEYS } from '../src/config.mjs';
import { PUBLIC_THEME_KEYS } from '../src/premium.mjs';
import { VIDEO_TARGETS, IMAGE_TARGETS } from '../src/specs.mjs';
import { TRANSITION_IDS } from '../src/transitions.mjs';
import { EFFECT_IDS } from '../src/effects.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dts = fs.readFileSync(path.join(root, 'types/index.d.ts'), 'utf8');

/** A config/theme key counts as typed only if it's DECLARED (`name?: T` / `name: T`), not just mentioned. */
const declares = (name) => new RegExp(`^\\s*${name}\\??\\s*:`, 'm').test(dts);
/** A target id counts as typed if it appears as a string-literal union member. */
const hasLiteral = (id) => dts.includes(`'${id}'`);

const missing = [
  ...CONFIG_KEYS.filter((k) => !declares(k)).map((n) => ({ n, kind: 'config field' })),
  ...PUBLIC_THEME_KEYS.filter((k) => !declares(k)).map((n) => ({ n, kind: 'theme option' })),
  ...Object.keys(VIDEO_TARGETS).filter((k) => !hasLiteral(k)).map((n) => ({ n, kind: 'video target' })),
  ...Object.keys(IMAGE_TARGETS).filter((k) => !hasLiteral(k)).map((n) => ({ n, kind: 'image target' })),
  ...TRANSITION_IDS.filter((k) => !hasLiteral(k)).map((n) => ({ n, kind: 'transition' })),
  ...EFFECT_IDS.filter((k) => !hasLiteral(k)).map((n) => ({ n, kind: 'effect' })),
];

if (missing.length) {
  console.error('✗ types out of sync with the code — not declared in types/index.d.ts:');
  for (const { n, kind } of missing) console.error(`   • ${n}  (${kind})`);
  console.error('\n  Declare each in the .d.ts (or rename/remove it), then re-run.');
  process.exit(1);
}

console.log(
  `✓ types in sync — ${CONFIG_KEYS.length} config fields + ${PUBLIC_THEME_KEYS.length} theme options + ` +
    `${Object.keys(VIDEO_TARGETS).length + Object.keys(IMAGE_TARGETS).length} targets + ` +
    `${TRANSITION_IDS.length} transitions + ${EFFECT_IDS.length} effects all declared.`
);
