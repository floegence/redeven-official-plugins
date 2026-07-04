# Redeven Official Plugins

This repository contains Redeven-maintained official plugins. It is not the
ReDevPlugin platform implementation and it does not store user-local plugin
state.

The first official plugin is `plugins/containers`, which exposes Redeven's
container resources capability through the ReDevPlugin package and lifecycle
contract.

## Repository Layout

```text
plugins/
  containers/
    manifest.json
    ui/
    README.md
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

To build the Containers package with the released ReDevPlugin CLI:

```bash
npm run package:containers
```

The package script writes release output under `dist/`. When
`REDEVEN_OFFICIAL_PLUGIN_SIGNING_KEY` points at an Ed25519 ReDevPlugin private
key file, it also writes a signed package and verifies it. Release automation is
responsible for uploading the signed package, checksum, signature metadata, and
notices to GitHub Releases and the Redeven plugin CDN.
