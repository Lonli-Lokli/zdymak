# Releasing zdymak

Publishing is automated via **npm Trusted Publishing (OIDC)**: no `NPM_TOKEN`, no secret to rotate or leak, and
provenance is generated automatically (the repo and the package are public). It is the path npm and GitHub recommend
now that long-lived tokens are gone: **classic tokens were revoked on 2025-12-09**, `npm login` gives a two-hour
session that still asks for your OTP to publish, and a granular write token lives at most 90 days. Trusted publishing
needs none of those.

## One-time setup, per package

The package already exists, so there is no chicken-and-egg. Sign in to npmjs.com as the package owner, open the package →
**Settings → Trusted publishing**, and add a **GitHub Actions** publisher:

| field | value |
|---|---|
| Organization or user | `Lonli-Lokli` |
| Repository | `zdymak` |
| Workflow filename | `publish.yml` (the name only, with the extension) |
| Environment | leave empty |
| Allowed actions | tick **`npm publish`**. Without it the workflow's publish is refused. |

Every field is case-sensitive and a saved entry cannot be edited: to change it, delete it and add it again. The same entry
can be made from a terminal with `npm login` then
`npm trust github zdymak --file publish.yml --repo Lonli-Lokli/zdymak --allow-publish` (`npm trust list zdymak` shows it);
that command exists in npm 11.16 but is not on the npm docs page, so treat the website as the reference.

Once the first publish through GitHub has succeeded, tighten the package: **Settings → Publishing access → "Require
two-factor authentication and disallow tokens"**, so nothing but trusted publishing (or an interactive session) can publish it.

## Every release: push, then publish a Release

1. Push your commits to `master`.
2. On GitHub: **Releases → Draft a new release → Choose a tag → type `v1.2.3` (a new tag) → Publish release.** Or from a
   terminal, as the account that owns the repository: `gh release create v1.2.3 --generate-notes --target master`.

That is all. **The tag is the version.** You do not run `npm version`, edit `package.json`, or push a tag. Publishing the
Release is the human approval gate, and it starts `.github/workflows/publish.yml`, which:

- refuses a Release that is not on `master`;
- installs, takes the version from the tag (`v1.2.3` becomes `1.2.3`; a tag that is not a version stops the release);
- refuses a version that is already on npm;
- runs `npm run verify` (through `prepublishOnly`), so a release that fails the drift guards or the tests publishes nothing;
- publishes over OIDC with provenance;
- writes the released version back into `package.json` on `master` as a `release: v1.2.3` commit (pull before your next push).

A tag like `v1.3.0-rc.1` is published under the `next` dist-tag, so `npm install` never picks it up, and is not written back.

**Do not run `npm run release:*` for a normal release.** That script publishes from your laptop first, so the workflow's
publish then fails because the version exists, and the package ends up with no provenance.

## Local publish (escape hatch)

For publishing without CI, one command bumps + publishes + pushes the tag. Run `npm login` first (a two-hour
session, since classic tokens no longer exist); npm then prompts for your 2FA OTP at publish time. It carries no provenance:

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
