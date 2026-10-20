// `zdymak capture --build`: the Xcode configuration is chosen by --configuration and shared by every xcodebuild call.
//   node --test scripts/xcode.test.mjs        (or: npm run check:xcode)
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildConfiguration, iosBuildArgs } from '../src/capture/xcode.mjs';

const base = { project: 'App.xcodeproj', scheme: 'App' };
const configOf = (args) => args[args.indexOf('-configuration') + 1];

test('no --configuration builds Debug, as before', () => {
  assert.equal(buildConfiguration({}), 'Debug');
  assert.equal(configOf(iosBuildArgs(base, 'U1').target), 'Debug');
});

test('--configuration Release reaches the argument list', () => {
  const { target } = iosBuildArgs({ ...base, configuration: 'Release' }, 'U1');
  assert.deepEqual(target, ['-project', 'App.xcodeproj', '-scheme', 'App', '-configuration', 'Release', '-destination', 'id=U1']);
});

test('a bare --configuration, or an empty one, is refused', () => {
  assert.throws(() => buildConfiguration({ configuration: true }), /--configuration needs a name/);
  assert.throws(() => buildConfiguration({ configuration: '  ' }), /--configuration needs a name/);
});

test('--derived-data is kept beside the configuration', () => {
  const { dd } = iosBuildArgs({ ...base, configuration: 'Release', 'derived-data': 'dd' }, 'U1');
  assert.deepEqual(dd, ['-derivedDataPath', path.resolve('dd')]);
});

test('index.mjs builds one target array for the build, -showBuildSettings and the install', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/capture/index.mjs', import.meta.url), 'utf8');
  assert.match(src, /xcodebuild', \['build', \.\.\.target/);
  assert.match(src, /'-showBuildSettings', '-json', \.\.\.target/);
  assert.doesNotMatch(src, /'-configuration'/);
});
