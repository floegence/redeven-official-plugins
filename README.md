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

To build the deterministic unsigned Containers package with the released
ReDevPlugin CLI:

```bash
npm run package:containers
```

The package script writes untracked output under `dist/`. The release commands
use ReDevPlugin's neutral external-signer exchange: `release:prepare` writes
public signing requests, `release:apply` accepts public responses, and
`release:finalize` plus `release:verify` produce and verify the complete GitHub
Release asset set. This repository never reads or stores private signing
material, and plugin package bytes are kept in GitHub Releases rather than git.
