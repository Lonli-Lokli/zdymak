/**
 * The xcodebuild arguments a `zdymak capture --build` run shares between the build, `-showBuildSettings` and the
 * install path, so all three always name the same configuration. `--configuration <name>` picks it; Debug is the default.
 */
import path from 'node:path';

export const DEFAULT_CONFIGURATION = 'Debug';

/** The Xcode build configuration a capture builds: `--configuration <name>`, else Debug. */
export function buildConfiguration(flags) {
  const c = flags.configuration;
  if (c === undefined) return DEFAULT_CONFIGURATION;
  if (typeof c !== 'string' || !c.trim()) throw new Error('--configuration needs a name (for example --configuration Capture).');
  return c.trim();
}

/** `{ target, dd }`: the project, scheme, configuration and destination, and the optional DerivedData pin. */
export function iosBuildArgs(flags, udid) {
  const target = ['-project', flags.project, '-scheme', flags.scheme, '-configuration', buildConfiguration(flags), '-destination', `id=${udid}`];
  const dd = typeof flags['derived-data'] === 'string' ? ['-derivedDataPath', path.resolve(flags['derived-data'])] : [];
  return { target, dd };
}
