// Tests for src/middleware.mjs. IDENTICAL in vydanne and zdymak, like the module itself.
//   node --test scripts/middleware.test.mjs        (or: npm run check:middleware)
import test from 'node:test';
import assert from 'node:assert/strict';
import { MiddlewareRefusal, normalizeMiddleware, runMiddleware } from '../src/middleware.mjs';

const ctxFor = (over = {}) => ({ tool: 'test', command: 'prerelease', store: 'google', ...over });

test('no middleware: the command runs and its result comes back', async () => {
  assert.equal(await runMiddleware(undefined, ctxFor(), async () => 'ran'), 'ran');
  assert.equal(await runMiddleware([], ctxFor(), async () => 'ran'), 'ran');
});

test('entries wrap the command first-outermost, and see the result on the way out', async () => {
  const seen = [];
  const mw = (label) => async (ctx, next) => {
    seen.push(`in:${label}`);
    const r = await next();
    seen.push(`out:${label}:${r}`);
    return r;
  };
  const result = await runMiddleware([mw('a'), mw('b')], ctxFor(), async () => { seen.push('command'); return 'ok'; });
  assert.deepEqual(seen, ['in:a', 'in:b', 'command', 'out:b:ok', 'out:a:ok']);
  assert.equal(result, 'ok');
});

test('an entry that returns nothing keeps the command result; one that returns a value replaces it', async () => {
  const quiet = async (ctx, next) => { await next(); };
  const loud = async (ctx, next) => { await next(); return 'replaced'; };
  assert.equal(await runMiddleware([quiet], ctxFor(), async () => 'original'), 'original');
  assert.equal(await runMiddleware([loud], ctxFor(), async () => 'original'), 'replaced');
});

test('ctx.fail refuses before the command runs, naming the entry and the reason', async () => {
  let ran = false;
  const gate = { name: 'release-gate', run(ctx) { ctx.fail('no receipt for this bundle'); } };
  await assert.rejects(
    runMiddleware([gate], ctxFor(), async () => { ran = true; }),
    (e) => e instanceof MiddlewareRefusal && e.middleware === 'release-gate' && e.reason === 'no receipt for this bundle' &&
      e.message === "refused by middleware 'release-gate': no receipt for this bundle",
  );
  assert.equal(ran, false);
});

test('commands and stores filters: an entry that does not match is skipped entirely', async () => {
  const calls = [];
  const only = { name: 'only', commands: ['prerelease'], stores: ['google'], run(ctx, next) { calls.push(ctx.command + ':' + ctx.store); return next(); } };
  await runMiddleware([only], ctxFor({ command: 'fill', store: 'google' }), async () => {});
  await runMiddleware([only], ctxFor({ command: 'prerelease', store: 'apple' }), async () => {});
  assert.deepEqual(calls, []);
  await runMiddleware([only], ctxFor(), async () => {});
  assert.deepEqual(calls, ['prerelease:google']);
});

test('a string is accepted wherever a list of names is', async () => {
  const [mw] = normalizeMiddleware([{ name: 'x', commands: 'prerelease', run() {} }]);
  assert.deepEqual(mw.commands, ['prerelease']);
});

test('a tool with no stores (zdymak) is not filtered out by a stores list', async () => {
  const calls = [];
  const mw = { stores: ['google'], run(ctx, next) { calls.push(ctx.command); return next(); } };
  await runMiddleware([mw], { tool: 'zdymak', command: 'screenshots' }, async () => {});
  assert.deepEqual(calls, ['screenshots']);
});

test('not calling next() skips the command, and says so', async () => {
  let ran = false;
  const logs = [];
  const real = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try {
    await runMiddleware([{ name: 'dry', run() { return 'stopped'; } }], ctxFor(), async () => { ran = true; });
  } finally {
    console.log = real;
  }
  assert.equal(ran, false);
  assert.match(logs.join('\n'), /prerelease skipped: middleware 'dry' did not call next\(\)/);
});

test('calling next() twice is an error, not a second run', async () => {
  let runs = 0;
  const twice = async (ctx, next) => { await next(); await next(); };
  await assert.rejects(runMiddleware([twice], ctxFor(), async () => { runs++; }), /called next\(\) twice/);
  assert.equal(runs, 1);
});

test('the context is shared, so a change made on the way in is seen by the command', async () => {
  const ctx = ctxFor({ config: { google: { track: 'internal' } } });
  const retrack = async (c, next) => { c.config.google.track = 'alpha'; return next(); };
  const track = await runMiddleware([retrack], ctx, async () => ctx.config.google.track);
  assert.equal(track, 'alpha');
});

test('a thrown error from an entry propagates untouched', async () => {
  await assert.rejects(runMiddleware([async () => { throw new TypeError('boom'); }], ctxFor(), async () => {}), TypeError);
});

test('after next() the log prefix is the outer entry again, not the inner one', async () => {
  const lines = [];
  const real = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    const inner = { name: 'inner', async run(ctx, next) { ctx.log('in'); return next(); } };
    const outer = { name: 'outer', async run(ctx, next) { await next(); ctx.log('after'); } };
    await runMiddleware([outer, inner], ctxFor(), async () => {});
  } finally {
    console.log = real;
  }
  assert.deepEqual(lines, ['[inner] in', '[outer] after']);
});

test('config validation: bad shapes fail at load with the entry named', () => {
  assert.throws(() => normalizeMiddleware('nope', 'vydanne'), /vydanne: config 'middleware' must be an array/);
  assert.throws(() => normalizeMiddleware([42], 'vydanne'), /'middleware'\[0\] must be a function/);
  assert.throws(() => normalizeMiddleware([{ run() {} }, { name: 'x' }], 'zdymak'), /zdymak: config 'middleware'\[1\] must be a function/);
  assert.throws(() => normalizeMiddleware([{ run() {}, commands: [1] }], 'zdymak'), /'commands' must be a string or an array of strings/);
  assert.deepEqual(normalizeMiddleware(undefined), []);
});

test('names: a function uses its own name, else its position', () => {
  async function releaseGate() {}
  const [a, b] = normalizeMiddleware([releaseGate, async () => {}]);
  assert.equal(a.name, 'releaseGate');
  assert.equal(b.name, 'middleware[1]');
});
