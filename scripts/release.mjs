#!/usr/bin/env node
/**
 * Local one-shot release: bump the version, publish to npm, push the tag.
 *
 *   node scripts/release.mjs patch|minor|major       (or: npm run release:patch)
 *
 * npm prompts for your 2FA OTP at publish time — no stored token. For fully token-free CI publishing
 * (with provenance), prefer the GitHub Release flow in RELEASING.md; this local path is the manual escape
 * hatch (first publish, or publishing without CI). Provenance is NOT generated locally.
 */
import { execSync } from 'node:child_process';

const type = process.argv[2] || 'patch';
if (!['patch', 'minor', 'major'].includes(type)) {
  console.error('usage: node scripts/release.mjs patch|minor|major');
  process.exit(1);
}

const run = (cmd) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
};

try {
  execSync('git diff --quiet && git diff --cached --quiet');
} catch {
  console.error('✗ Working tree not clean — commit or stash first (npm version needs a clean tree).');
  process.exit(1);
}

run('node scripts/check-docs.mjs'); //           fail early if docs drifted (also enforced on prepublishOnly)
run(`npm version ${type} -m "release: v%s"`); // bumps package.json + creates the git tag
run('npm publish --access public'); //           npm asks for your 2FA OTP
run('git push --follow-tags');
console.log('\n✓ Published to npm + pushed the tag.');
