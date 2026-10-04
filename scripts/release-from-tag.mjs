#!/usr/bin/env node
/**
 * The release TAG is the version. This is what .github/workflows/publish.yml runs, so nobody bumps package.json by hand,
 * runs `npm version`, or pushes a tag from a laptop: you push your commits, publish a GitHub Release named `v1.2.3`, and
 * the workflow does the rest.
 *
 *   node scripts/release-from-tag.mjs v1.2.3             sets package.json (and the lockfile) to 1.2.3, prints
 *                                                         version=1.2.3 and dist-tag=latest for $GITHUB_OUTPUT
 *   node scripts/release-from-tag.mjs v1.3.0-rc.1        a prerelease: dist-tag=next, so `npm install` never picks it up
 *   node scripts/release-from-tag.mjs v1.2.3 --dry-run   validates and prints; changes nothing
 *
 * IDENTICAL in vydanne and zdymak. It reads the package name from package.json and carries nothing specific to either.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** `v1.2.3`, `1.2.3` or `v1.2.3-rc.1`. No build metadata and nothing else: a tag that is not a version stops the release. */
const TAG = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/** The version and npm dist-tag a release tag means, or an Error saying why it is not a release tag. */
export function parseTag(tag) {
  const m = TAG.exec(String(tag ?? '').trim());
  if (!m) {
    throw new Error(`release tag '${tag}' is not a version: use v<major>.<minor>.<patch>, optionally -<prerelease> (v1.2.3, v1.3.0-rc.1)`);
  }
  const [, major, minor, patch, pre] = m;
  for (const part of [major, minor, patch]) {
    if (part.length > 1 && part.startsWith('0')) throw new Error(`release tag '${tag}' has a leading zero in '${part}'`);
  }
  const version = `${major}.${minor}.${patch}${pre ? `-${pre}` : ''}`;
  // A prerelease must never become `latest`, or every `npm install vydanne` in every game would pick it up.
  return { version, distTag: pre ? 'next' : 'latest' };
}

function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run');
  const tag = args.find((a) => !a.startsWith('--'));
  if (!tag) {
    console.error('usage: node scripts/release-from-tag.mjs <tag> [--dry-run]');
    process.exit(2);
  }
  let parsed;
  try {
    parsed = parseTag(tag);
  } catch (e) {
    console.error(`::error::${e.message}`);
    process.exit(1);
  }
  if (!dry) {
    // npm itself edits package.json AND the lockfile together, which is why this is not a regex over the file.
    execFileSync('npm', ['version', parsed.version, '--no-git-tag-version', '--allow-same-version'], { stdio: ['ignore', 'ignore', 'inherit'] });
  }
  // `key=value` lines: appended to $GITHUB_OUTPUT by the workflow, readable by a person when run by hand.
  console.log(`version=${parsed.version}`);
  console.log(`dist-tag=${parsed.distTag}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
