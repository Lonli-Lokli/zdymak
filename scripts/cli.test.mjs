// End-to-end tests for `zdymak check` and for middleware running through the real CLI process.
//   node --test scripts/cli.test.mjs        (or: npm run check:cli)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(root, 'bin', 'zdymak.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zdymak-cli-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const zdymak = (args, opts = {}) =>
  spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', cwd: tmp, ...opts });

/** A flat single-colour screen: what an app that drew nothing photographs as. */
function blankPng(file) {
  const c = createCanvas(300, 600);
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 300, 600);
  fs.writeFileSync(file, c.toBuffer('image/png'));
}

/** A busy screen: thousands of distinct colours, no one of them dominant. */
function realPng(file) {
  const c = createCanvas(300, 600);
  const g = c.getContext('2d');
  for (let y = 0; y < 600; y += 2) {
    for (let x = 0; x < 300; x += 2) {
      g.fillStyle = `rgb(${(x * 7 + y) % 256},${(y * 3 + x * 5) % 256},${(x + y * 11) % 256})`;
      g.fillRect(x, y, 2, 2);
    }
  }
  fs.writeFileSync(file, c.toBuffer('image/png'));
}

const shots = path.join(tmp, 'shots');
fs.mkdirSync(shots);
blankPng(path.join(shots, 'blank.png'));
realPng(path.join(shots, 'real.png'));

test('check passes a real screen', () => {
  const r = zdymak(['check', path.join(shots, 'real.png')]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /✓ .*real\.png/);
});

test('check fails a blank capture and says why', () => {
  const r = zdymak(['check', path.join(shots, 'blank.png')]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /✗ .*blank\.png {2}BLANK — 1 distinct colours, 100\.0% one colour/);
});

test('check searches a folder and reports each file; one blank fails the run', () => {
  const r = zdymak(['check', shots]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /2 capture\(s\)/);
  assert.match(r.stdout, /✓ .*real\.png/);
  assert.match(r.stdout, /✗ .*blank\.png/);
});

test('check --json is machine-readable and --force reports without failing', () => {
  const r = zdymak(['check', shots, '--json', '--force']);
  assert.equal(r.status, 0);
  const rows = JSON.parse(r.stdout);
  const by = Object.fromEntries(rows.map((x) => [path.basename(x.file), x]));
  assert.equal(by['blank.png'].blank, true);
  assert.equal(by['real.png'].blank, false);
  assert.ok(by['real.png'].colours > 400);
});

test('check refuses a file that is not a PNG it can decode', () => {
  const junk = path.join(tmp, 'junk.png');
  fs.writeFileSync(junk, 'not an image');
  const r = zdymak(['check', junk]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /UNREADABLE/);
});

test('check with nothing to check, or a path that does not exist, is an error', () => {
  assert.equal(zdymak(['check']).status, 1);
  const r = zdymak(['check', path.join(tmp, 'nope')]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no such file or folder/);
});

function configWith(body) {
  const file = path.join(tmp, `config-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(file, `export default { ${body} };\n`);
  return file;
}

test('middleware runs through the CLI with the command, args and flags in its context', () => {
  const probe = path.join(tmp, 'probe.json');
  const cfg = configWith(`
    out: 'out-dir',
    middleware: [{ name: 'probe', commands: ['check'], async run(ctx, next) {
      (await import('node:fs')).writeFileSync(${JSON.stringify(probe)}, JSON.stringify({
        tool: ctx.tool, command: ctx.command, args: ctx.args.map((a) => a.split('/').pop()), json: ctx.flags.json === true,
        hasConfig: !!ctx.config, outDir: ctx.outDir,
      }));
      return next();
    } }]`);
  const r = zdymak(['check', path.join(shots, 'real.png'), '--json', '--config', cfg]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(probe, 'utf8')), {
    tool: 'zdymak', command: 'check', args: ['real.png'], json: true, hasConfig: true, outDir: null,
  });
});

test('middleware can refuse, before the command runs', () => {
  const cfg = configWith(`middleware: [{ name: 'gate', run(ctx) { ctx.fail('not today'); } }]`);
  const r = zdymak(['check', path.join(shots, 'real.png'), '--config', cfg]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /refused by middleware 'gate': not today/);
  assert.doesNotMatch(r.stdout, /zdymak check/); // the command never ran
});

test('middleware can inspect what the command wrote, after it ran', () => {
  // `check` writes nothing, so the after-hook uses changedFiles() on a folder the middleware itself touches.
  const out = path.join(tmp, 'wrote');
  fs.mkdirSync(out);
  const seen = path.join(tmp, 'seen.json');
  const cfg = configWith(`
    out: ${JSON.stringify(out)},
    middleware: [{ name: 'after', commands: ['screenshots'], async run(ctx, next) {
      const fs = await import('node:fs');
      fs.writeFileSync(ctx.outDir + '/new.png', 'x');
      const names = ctx.changedFiles(['.png']).map((f) => f.split('/').pop());
      fs.writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ names, outDir: ctx.outDir }));
      return next();
    } }]`);
  // `screenshots` fails later for lack of devices, which is fine: the middleware has already run.
  zdymak(['screenshots', '--config', cfg]);
  const got = JSON.parse(fs.readFileSync(seen, 'utf8'));
  assert.deepEqual(got.names, ['new.png']);
  assert.equal(fs.realpathSync(got.outDir), fs.realpathSync(out));
});

test('a malformed middleware entry fails at config load, naming the entry', () => {
  const cfg = configWith(`middleware: [42]`);
  const r = zdymak(['check', path.join(shots, 'real.png'), '--config', cfg]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /zdymak: config 'middleware'\[0\] must be a function/);
});

test('specs and help are not wrapped, so a refusing middleware does not block them', () => {
  const cfg = configWith(`middleware: [{ name: 'gate', run(ctx) { ctx.fail('no'); } }]`);
  assert.equal(zdymak(['specs', '--config', cfg]).status, 0);
});
