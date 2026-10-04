/**
 * Middleware: a consumer's own logic around every command.
 *
 * THIS FILE IS IDENTICAL IN vydanne AND zdymak. Both tools take the same `middleware` config key and give
 * it the same semantics, so a check written for one reads the same in the other. Change both together.
 *
 *   // vydanne.config.mjs or zdymak.config.mjs
 *   export default {
 *     middleware: [
 *       // a function: runs for every command
 *       async (ctx, next) => {
 *         console.log(`about to run ${ctx.command}`);
 *         const result = await next();           // the rest of the chain, then the command itself
 *         console.log('done');
 *         return result;                          // return nothing and the command's own result is kept
 *       },
 *       // an object: the same function, limited to the commands (and stores) it names
 *       {
 *         name: 'release-gate',
 *         commands: ['prerelease'],
 *         stores: ['google'],                     // vydanne only
 *         run(ctx, next) {
 *           if (ctx.apply && !receiptFor(ctx)) ctx.fail('no receipt for this bundle');
 *           return next();
 *         },
 *       },
 *     ],
 *   };
 *
 * Order is the array order: the first entry is the outermost. Code before `await next()` runs on the way in and
 * may REFUSE (`ctx.fail(message)` stops the command and exits non-zero); code after it runs on the way out and
 * sees the command's result. An entry that never calls `next()` skips the command, and says so. `ctx` carries
 * what the tool knows (see each tool's docs); `ctx.config` is the live config, so a change made on the way in
 * is seen by the command.
 *
 * What middleware is NOT: a plugin system for new commands, and not a sandbox. It runs with the full power of
 * the config file it lives in, which is already arbitrary code.
 */

/** Thrown by `ctx.fail`. The CLIs print it as a refusal and exit 1, with no stack trace. */
export class MiddlewareRefusal extends Error {
  constructor(reason, middleware) {
    super(`refused by middleware '${middleware}': ${reason}`);
    this.name = 'MiddlewareRefusal';
    this.middleware = middleware;
    this.reason = reason;
  }
}

function names(value, label, where) {
  if (value == null) return null;
  const list = Array.isArray(value) ? value : [value];
  if (!list.every((x) => typeof x === 'string' && x)) {
    throw new Error(`${where}: '${label}' must be a string or an array of strings`);
  }
  return list;
}

/**
 * Validate the `middleware` config value and return `{ name, commands, stores, run }` entries.
 * A bad entry is a config error at load time, never a surprise halfway through a release.
 */
export function normalizeMiddleware(list, tool = 'tool') {
  if (list == null) return [];
  if (!Array.isArray(list)) {
    throw new Error(`${tool}: config 'middleware' must be an array of functions or { run } objects, got ${typeof list}`);
  }
  return list.map((entry, i) => {
    const where = `${tool}: config 'middleware'[${i}]`;
    const fallback = `middleware[${i}]`;
    if (typeof entry === 'function') return { name: entry.name || fallback, commands: null, stores: null, run: entry };
    if (entry && typeof entry === 'object' && typeof entry.run === 'function') {
      return {
        name: String(entry.name ?? (entry.run.name || fallback)),
        commands: names(entry.commands, 'commands', where),
        stores: names(entry.stores, 'stores', where),
        run: entry.run,
      };
    }
    throw new Error(`${where} must be a function (ctx, next) or an object with a run(ctx, next) function`);
  });
}

/**
 * Run `final` (the command) inside the middleware chain and return its result.
 *
 * `ctx` is the tool's context object; `log`, `warn` and `fail` are added to it here, so an entry can say
 * `ctx.fail('...')` without importing anything.
 */
export async function runMiddleware(list, ctx, final) {
  const chain = normalizeMiddleware(list, ctx.tool);
  if (chain.length === 0) return final();

  const current = { name: 'middleware' };
  ctx.log = (...args) => console.log(`[${current.name}]`, ...args);
  ctx.warn = (...args) => console.warn(`[${current.name}]`, ...args);
  ctx.fail = (reason) => {
    throw new MiddlewareRefusal(reason, current.name);
  };

  const dispatch = async (i) => {
    if (i === chain.length) return final();
    const mw = chain[i];
    if (mw.commands && !mw.commands.includes(ctx.command)) return dispatch(i + 1);
    if (mw.stores && ctx.store && !mw.stores.includes(ctx.store)) return dispatch(i + 1);

    let called = false;
    let inner;
    const next = async () => {
      if (called) throw new Error(`middleware '${mw.name}' called next() twice`);
      called = true;
      inner = await dispatch(i + 1);
      current.name = mw.name; // control is back with this entry, so its messages carry its name again
      return inner;
    };

    current.name = mw.name;
    const result = await mw.run(ctx, next);
    if (!called) console.log(`  (${ctx.command} skipped: middleware '${mw.name}' did not call next())`);
    // An entry that only guards on the way in has nothing to return; the command's own result is kept.
    return result === undefined ? inner : result;
  };

  return dispatch(0);
}
