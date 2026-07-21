/**
 * Web capture driver (Playwright) — the browser sibling of the iOS/Android drivers.
 *
 * A web app's "handle" for reaching a seeded screen is simply its URL, so `--states` here is a list of
 * paths (or absolute URLs) rather than launch-arg ids:
 *
 *   zdymak capture --platform web --url http://localhost:3000 \
 *     --states /,/today,/study --suffix -light --out marketing/web/captures
 *
 * Playwright is an OPTIONAL dependency: it pulls a browser binary (hundreds of MB), which nobody
 * capturing only iOS/Android should pay for. It's imported lazily, with an install hint when absent.
 *
 * Marketing shots must be reproducible — a re-run should differ only where the UI did. So every page is
 * loaded with animations disabled, `prefers-reduced-motion: reduce`, a fixed viewport + device scale
 * factor, and the shot waits for fonts to finish loading (a webfont swapping in one frame late is the
 * classic source of "why is this screenshot different").
 */
import fs from 'node:fs';
import path from 'node:path';

/** Lazily load Playwright, turning the module-not-found case into an actionable message. */
async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    throw new Error(
      'web capture needs Playwright (optional dependency — it downloads a browser).\n' +
        '  npm i -D playwright && npx playwright install chromium',
    );
  }
}

/**
 * `/` → `home`, `/today` → `today`, `/decks/new` → `decks-new`, `?a=1` dropped. Absolute URLs use their
 * pathname. Keeps capture filenames stable and scene-id-shaped, so they line up with a `scenes` list.
 */
export function stateToName(state) {
  const p = (state.includes('://') ? new URL(state).pathname : state.split('?')[0].split('#')[0])
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.html?$/i, ''); // static exports (`/today.html`) get the same id as a routed `/today`
  const name = p ? p.replace(/[/\\]+/g, '-').replace(/[^\w.-]+/g, '-') : 'home';
  return name === 'index' ? 'home' : name; // `/index.html` is the landing page, same as `/`
}

/** Join a base URL with a state that may be a path or an absolute URL. */
export function resolveUrl(base, state) {
  if (state.includes('://')) return state;
  if (!base) throw new Error(`web capture: --url is required to resolve the relative state "${state}".`);
  return new URL(state, base).href;
}

const parseViewport = (v) => {
  const m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(String(v || '').trim());
  if (!m) throw new Error(`--viewport must look like 1280x800 (got "${v}").`);
  return { width: Number(m[1]), height: Number(m[2]) };
};

export async function captureWeb(flags, { stripAlpha, sleep }) {
  const { chromium, devices } = await loadPlaywright();

  const outDir = path.resolve(flags.out || 'shots');
  fs.mkdirSync(outDir, { recursive: true });
  if (flags.clean) {
    let cleared = 0;
    for (const f of fs.readdirSync(outDir)) {
      if (/\.png$/i.test(f)) { fs.rmSync(path.join(outDir, f), { force: true }); cleared++; }
    }
    console.log(`🧹 cleaned ${cleared} stale capture(s) in ${path.relative(process.cwd(), outDir) || outDir}`);
  }

  // A Playwright device descriptor (`--device "iPhone 15 Pro"`) brings its own viewport, scale factor and
  // user agent — the honest way to shoot a mobile-web screen. Otherwise: an explicit desktop viewport.
  const descriptor = flags.device ? devices[flags.device] : undefined;
  if (flags.device && !descriptor) {
    throw new Error(`--device "${flags.device}" is not a Playwright device. Try e.g. "iPhone 15 Pro", "Pixel 7", "iPad Pro 11".`);
  }
  const contextOptions = {
    ...(descriptor || {
      viewport: parseViewport(flags.viewport || '1280x800'),
      deviceScaleFactor: Number(flags.dsf || 2), // 2 = retina-sharp; store shots get downscaled, never upscaled
    }),
    colorScheme: flags.theme === 'dark' ? 'dark' : 'light',
    reducedMotion: 'reduce',
    locale: flags.locale || undefined,
  };

  const browser = await chromium.launch();
  const context = await browser.newContext(contextOptions);
  // Kill CSS/SMIL animation and caret blink outright — `reducedMotion` is only a hint the app may ignore.
  await context.addInitScript(() => {
    const css = `*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;
      transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important}`;
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = css;
      document.head.appendChild(s);
    });
  });
  const page = await context.newPage();

  const settle = Number(flags.settle ?? 1);
  const shoot = async (url, file) => {
    await page.goto(url, { waitUntil: 'networkidle' });
    if (flags.wait) await page.waitForSelector(String(flags.wait), { state: 'visible' });
    // Webfonts + lazy images are the two things that land after `networkidle` and silently change a shot.
    await page.evaluate(() => document.fonts?.ready);
    await page.evaluate(() => Promise.all(
      Array.from(document.images).filter((i) => !i.complete).map((i) => i.decode().catch(() => {})),
    ));
    if (settle) await sleep(settle * 1000);
    await page.screenshot({ path: file, fullPage: !!flags['full-page'] });
    await stripAlpha(file); // stores reject transparency
  };

  try {
    const suffix = flags.suffix || '';
    if (flags.states) {
      const states = String(flags.states).split(',').map((s) => s.trim()).filter(Boolean);
      const { width, height } = page.viewportSize() || {};
      console.log(`▶︎ Capturing ${states.length} page(s) at ${width}×${height}${flags.device ? ` (${flags.device})` : ''}…`);
      for (const state of states) {
        const file = path.join(outDir, `${stateToName(state)}${suffix}.png`);
        await shoot(resolveUrl(flags.url, state), file);
        console.log(`   ✓ ${path.basename(file)}`);
      }
      console.log(`Done → ${outDir}`);
    } else {
      if (!flags.url) throw new Error('web capture needs --url <page> (plus --states for the full workflow).');
      const file = path.join(outDir, `${flags.name || stateToName(flags.url)}${suffix}.png`);
      await shoot(flags.url, file);
      console.log(`✓ ${file}  (alpha stripped, store-ready)`);
    }
  } finally {
    await context.close();
    await browser.close();
  }
}
