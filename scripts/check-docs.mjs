#!/usr/bin/env node
/**
 * Doc-sync guard — fails if the public config surface has drifted from the docs.
 *
 * Every top-level config field (`CONFIG_KEYS`) and every app-facing theme option (`PUBLIC_THEME_KEYS`)
 * must be mentioned in README.md or SKILL.md. Adding a public knob without documenting it fails this check,
 * so the docs can't silently fall behind the code. Runs on `prepublishOnly` (local + CI publish both hit
 * it) and inside `scripts/release.mjs`.
 *
 *   node scripts/check-docs.mjs        (or: npm run check:docs)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_KEYS } from '../src/config.mjs';
import { PUBLIC_THEME_KEYS } from '../src/premium.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = ['README.md', 'SKILL.md']
  .map((f) => fs.readFileSync(path.join(root, f), 'utf8'))
  .join('\n');

const surface = [
  ...CONFIG_KEYS.map((k) => ({ name: k, kind: 'config field' })),
  ...PUBLIC_THEME_KEYS.map((k) => ({ name: k, kind: 'theme option' })),
];

// A name counts as documented if it appears verbatim anywhere in the docs (e.g. `stillTheme`, `captionAnchor`).
const missing = surface.filter(({ name }) => !docs.includes(name));

if (missing.length) {
  console.error('✗ docs out of sync with the code — not documented in README.md / SKILL.md:');
  for (const { name, kind } of missing) console.error(`   • ${name}  (${kind})`);
  console.error('\n  Document each (or rename/remove it) so the docs match the public surface, then re-run.');
  process.exit(1);
}

console.log(
  `✓ docs in sync — ${CONFIG_KEYS.length} config fields + ${PUBLIC_THEME_KEYS.length} theme options all documented.`
);
