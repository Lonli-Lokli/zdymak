// Tests for scripts/release-from-tag.mjs. IDENTICAL in vydanne and zdymak.
//   node --test scripts/release-from-tag.test.mjs        (or: npm run check:release)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseTag } from './release-from-tag.mjs';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'release-from-tag.mjs');

test('a release tag is the version, with or without the v', () => {
  assert.deepEqual(parseTag('v1.2.3'), { version: '1.2.3', distTag: 'latest' });
  assert.deepEqual(parseTag('1.2.3'), { version: '1.2.3', distTag: 'latest' });
  assert.deepEqual(parseTag('v10.0.0'), { version: '10.0.0', distTag: 'latest' });
  assert.deepEqual(parseTag(' v1.0.0 '), { version: '1.0.0', distTag: 'latest' });
});

test('a prerelease goes to the next dist-tag so npm install never picks it up', () => {
  assert.deepEqual(parseTag('v1.3.0-rc.1'), { version: '1.3.0-rc.1', distTag: 'next' });
  assert.deepEqual(parseTag('v2.0.0-beta'), { version: '2.0.0-beta', distTag: 'next' });
});

test('anything that is not a version stops the release', () => {
  for (const bad of ['', undefined, 'latest', 'v1', 'v1.2', 'v1.2.3.4', 'release-1.2.3', 'v1.2.3+build5', 'v01.2.3', 'v1.02.3', 'v1.2.3-', 'v1.2.3-a..b', '../x']) {
    assert.throws(() => parseTag(bad), /is not a version|leading zero/, `should refuse ${JSON.stringify(bad)}`);
  }
});

function scratchPackage(version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rft-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fake', version, private: true }, null, 2) + '\n');
  return dir;
}

test('the CLI sets package.json from the tag and prints the workflow outputs', () => {
  const dir = scratchPackage('0.26.0');
  const r = spawnSync(process.execPath, [script, 'v1.0.0'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'version=1.0.0\ndist-tag=latest\n');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version, '1.0.0');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--dry-run validates and prints but changes nothing', () => {
  const dir = scratchPackage('0.26.0');
  const r = spawnSync(process.execPath, [script, 'v1.1.0-rc.2', '--dry-run'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'version=1.1.0-rc.2\ndist-tag=next\n');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version, '0.26.0');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the CLI refuses a tag that is not a version, with a GitHub error annotation and a non-zero exit', () => {
  const dir = scratchPackage('0.26.0');
  const r = spawnSync(process.execPath, [script, 'nightly'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^::error::release tag 'nightly' is not a version/);
  assert.equal(r.stdout, '');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version, '0.26.0');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('no tag is a usage error', () => {
  assert.equal(spawnSync(process.execPath, [script], { encoding: 'utf8' }).status, 2);
});
