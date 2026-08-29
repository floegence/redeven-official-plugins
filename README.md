# Redeven Official Plugins

This repository is the reusable source, validation, catalog, packaging, and
release framework for Redeven-maintained official plugins. It is not the
ReDevPlugin platform implementation and it does not store user-local plugin
state.

The current catalog contains the official Weather plugin. It pairs a local
clock with current conditions, seven-day temperature trends, saved places, and
offline forecast fallback through ReDevPlugin's brokered network and storage
contracts. Container management remains a native Redeven product feature, so
its former plugin source and release-train directories are intentionally absent.
Historical tags and immutable releases remain the audit record.

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

When a new official plugin is added, give it a package-specific build script
and use the generic packager with the released ReDevPlugin CLI:

```bash
node scripts/build_official_plugin.mjs <plugin-name>
```

Weather can be built and packaged with:

```bash
npm --prefix plugins/weather ci
npm run package:weather
```

The package script writes untracked output under `dist/`. The release commands
use ReDevPlugin's neutral external-signer exchange: `release:prepare` writes
public signing requests, `release:apply` accepts public responses, and
`release:finalize` plus `release:verify` produce and verify the complete GitHub
Release asset set. This repository never reads or stores private signing
material, and plugin package bytes are kept in GitHub Releases rather than git.
Weather release preparation builds its WASM worker in a pinned Linux AMD64
container at a fixed source path, so external signing and GitHub publication
operate on byte-identical package input across developer machines and CI.
