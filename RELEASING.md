# Releasing zdymak

Publishing is automated via **npm Trusted Publishing (OIDC)** — no `NPM_TOKEN`, no secret to rotate or
leak. It's the path npm now recommends after deprecating 2FA-bypass tokens (those lose publish ability
~Jan 2027). Provenance is generated automatically.

## One-time setup (≈2 minutes)

1. **First publish** (creates the package name). From a clean checkout, with 2FA on your npm account:
   ```sh
   npm publish --access public
   ```
   (Chicken-and-egg: a trusted publisher can only be attached to a package that exists.)

2. **Attach the trusted publisher.** npmjs.com → the `zdymak` package → **Settings → Trusted Publishers →
   Add** → GitHub Actions · repo `<you>/zdymak` · workflow `publish.yml`. (Leave environment blank unless
   you use one.)

That's it — from now on CI publishes with zero tokens.

## Every release

```sh
npm version patch          # or minor / major — bumps package.json + tags
git push --follow-tags
gh release create "v$(node -p "require('./package.json').version")" --generate-notes
```

Creating the GitHub **Release** fires `.github/workflows/publish.yml`, which runs `npm publish` over OIDC.
The Release step is your human approval gate.

## Local publish (escape hatch)

For the **first** publish, or publishing without CI, one command bumps + publishes + pushes the tag (npm
prompts for your 2FA OTP — no stored token):

```sh
npm run release:patch      # or release:minor / release:major
```

`scripts/release.mjs` refuses to run on a dirty tree. Provenance is only generated on the CI/OIDC path, so
prefer the GitHub Release flow for regular releases.

## Notes

- **npm v12 install-time security**: lifecycle scripts are off by default now, but zdymak's only dependency
  (`@napi-rs/canvas`) ships **prebuilt** platform binaries via optional dependencies — no build script — so
  `npm ci` needs no `--allow-scripts`.
- **Provenance** requires a **public** repo; on a private repo publishing still works but no provenance
  statement is generated.
- Consumers install with `npm i zdymak` and need **ffmpeg** on PATH (documented in the README).
