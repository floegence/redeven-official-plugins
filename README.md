# Redeven Official Plugins

This repository is the reusable source, validation, packaging, and
release framework for Redeven-maintained official plugins. It is not the
ReDevPlugin platform implementation and it does not store user-local plugin
state.

The current catalog contains Weather and Mind Map. Weather pairs a local clock
with forecasts through ReDevPlugin's brokered network and storage contracts.
Mind Map is an offline-first Canvas editor with brokered user-scoped storage,
optimistic revision checks, multi-document editing, and a portable indentation
DSL for import and export. Retired plugin source is intentionally absent. Historical tags and
immutable releases remain the audit record.

## Repository Layout

```text
.redevplugin/index.json
plugins/
  <plugin-name>/
    manifest.json
    release.json
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
dependency installation, CI, and repository validation discover every
`plugins/*/manifest.json` plus `release.json` pair instead of maintaining a
plugin-name list.

The repository index lists each plugin, its source manifest, and its ordinary
package asset template. Each plugin uses `<plugin-name>-v{version}` tags. Both
plugins may release the same version independently. No legacy tag fallback or
client capability negotiation exists.

`npm run catalog:verify` validates the index through the exact released CLI. The
market derives all presentation from `release inspect`; this repository does not
maintain a second catalog or replace author descriptions with display names.

`npm run release:build -- <plugin-name>` runs the plugin's `build:release`, builds
an ordinary package, and records distinct archive and canonical package digests.
`npm run release:verify -- <plugin-name>` re-inspects the package and checks those
values. Publication uploads only the package and checksum metadata, then reads
back and compares the exact bytes. No signing keys, trust documents, publisher
registration, or review exchange is required. Existing published artifacts are
never replaced.

Weather's package-local release build compiles its WASM worker in a pinned Linux
AMD64 container. Mind Map builds its permissionless storage Worker through the
same package interface. Local output stays under ignored `dist/` directories.
