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
import { execSync, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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

// npm AUTH GATE — must run before anything mutates the repo. `npm version` creates a commit AND a tag, so
// discovering a bad login at `npm publish` time leaves the repo bumped + tagged but nothing published, which
// then has to be unpicked by hand. Fail here instead, while the tree is still untouched.
const quiet = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
let who;
try {
  who = execFileSync('npm', ['whoami'], quiet).trim();
} catch {
  console.error('✗ Not logged in to npm — run `npm login`, then retry.');
  process.exit(1);
}
const { name } = JSON.parse(readFileSync('package.json', 'utf8'));
try {
  // Existing package: confirm THIS account may publish it. A 404 here means the name is unclaimed, i.e.
  // this is the first publish — allowed, so the catch is a pass, not a failure.
  const owners = execFileSync('npm', ['owner', 'ls', name], quiet);
  if (!owners.split('\n').some((l) => l.split(' ')[0] === who)) {
    console.error(`✗ npm user '${who}' is not an owner of '${name}' — publish would be rejected.`);
    console.error(`  Owners: ${owners.trim().replace(/\n/g, ', ') || '(none reported)'}`);
    process.exit(1);
  }
  console.log(`✓ npm: '${who}' can publish '${name}'.`);
} catch (e) {
  if (e.status === undefined) throw e; // spawn failure, not a registry 404
  console.log(`✓ npm: authenticated as '${who}'. '${name}' is unpublished — this will be the FIRST publish.`);
}

run('node scripts/check-docs.mjs'); //           fail early if docs drifted (also enforced on prepublishOnly)
run(`npm version ${type} -m "release: v%s"`); // bumps package.json + creates the git tag
run('npm publish --access public'); //           npm asks for your 2FA OTP
run('git push --follow-tags');
console.log('\n✓ Published to npm + pushed the tag.');
