# Redeven Official Plugins

This repository is the reusable source, validation, catalog, packaging, and
release framework for Redeven-maintained official plugins. It is not the
ReDevPlugin platform implementation and it does not store user-local plugin
state.

The current catalog contains Weather and Mind Map. Weather pairs a local clock
with forecasts through ReDevPlugin's brokered network and storage contracts.
Mind Map is an offline-first Canvas editor with brokered user-scoped storage,
optimistic revision checks, multi-document editing, and portable JSON import
and export. Retired plugin source is intentionally absent. Historical tags and
immutable releases remain the audit record.

## Repository Layout

```text
plugins/
  <plugin-name>/
    manifest.json
    release.json
catalog/
  official-catalog.schema.json
  official-catalog.seed.json
scripts/
  build_official_plugin.mjs
  check_official_plugins.mjs
  generate_official_catalog.mjs
tests/
  officialPlugins.test.mjs
```

## Development

Use a feature worktree. Do not develop on `main`.

```bash
npm test
npm run check
npm run catalog:verify
```

When a new official plugin is added, give it the common `build`,
`build:release`, `test`, and `typecheck` package interface, then use the generic
packager with the released ReDevPlugin CLI:

```bash
node scripts/build_official_plugin.mjs <plugin-name>
```

Weather can be built and packaged with:

```bash
npm --prefix plugins/weather ci
npm run package:weather
```

Mind Map uses the same commands through `package:mind-map`. Root tests,
dependency installation, CI, and catalog generation discover every
`plugins/*/manifest.json` plus `release.json` pair instead of maintaining a
plugin-name list.

The package script writes untracked output under `dist/`. The release commands
use ReDevPlugin's neutral external-signer exchange: `release:prepare` writes
public signing requests, `release:apply` accepts public responses, and
`release:finalize` plus `release:verify` produce and verify the complete GitHub
Release asset set. This repository never reads or stores private signing
material, and plugin package bytes are kept in GitHub Releases rather than git.
Repository tags are globally unique. A tag must match exactly one plugin's
`release_train_tag`, and that tag publishes only the matching plugin's exact
asset names. Markets must use that release reference so independent plugin
release trains cannot select one another's assets. Weather's package-local
`build:release` builds its WASM worker in a pinned Linux AMD64 container. Mind
Map builds its permissionless storage Worker behind its package-local release
interface, so the shared release framework remains plugin-neutral.
