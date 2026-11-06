# Redeven Official Plugins Repository Guide

This repository is the source of truth for Redeven-maintained official plugins.
It does not own the ReDevPlugin platform, Redeven runtime shell, or user-local
plugin installation state.

## Scope

- Maintain official plugin source, plugin UI assets, manifests, tests, package
  scripts, repository index, and release metadata.
- First-party plugins only. Do not add third-party marketplace, URL install,
  file install, developer mode, ratings, comments, or
  remote recommendation features here.
- ReDevPlugin platform mechanics stay in released `redevplugin` artifacts.
  This repository must not implement a registry, lifecycle API, bridge token
  issuer, asset ticket flow, manifest parser, package validator, runtime
  supervisor, storage broker, network broker, WASM executor, or operation stream
  protocol.
- Redeven host-product policy and shell placement stay in `../redeven`.
  User-local install, enable, disable, update, uninstall, retained data, audit,
  and runtime state are owned by the embedded ReDevPlugin Host inside Redeven.

## Git Workflow

- Never develop directly on `main`.
- Every change must be done in a dedicated worktree plus feature branch.
- `main` is only for final integration and `push`.
- Do not create `backup/*` branches.
- Do not leave uncommitted changes in the `main` worktree.
- Use one feature branch per topic. Feature worktree directories live next to
  this repository and use `../redeven-official-plugins-feat-<topic>`.
- Feature branches use `feat-<topic>` unless the user explicitly requests a
  different name.
- Keep feature branches private until they are merged into `main`.
- Do not push feature branches unless the user explicitly asks.
- Preserve meaningful commit history. Integrate ready feature branches into
  `main` with `git merge --ff-only`.
- The only bootstrap exception is the first repository commit: because the
  repository starts with an unborn `main`, create the first content in an orphan
  feature worktree, run the local gate, then fast-forward unborn `main` to the
  validated feature tip and push `main`.

Bootstrap example:

```bash
BR=feat-first-official-plugin
WT=../redeven-official-plugins-feat-first-official-plugin
git worktree add --orphan -b "$BR" "$WT"

# develop and test in "$WT"

cd /Users/tangjianyin/Downloads/code/redeven-official-plugins
git switch main
git merge --ff-only "$BR"
git push -u origin main
git worktree remove "$WT"
git branch -d "$BR"
```

Normal feature flow after bootstrap:

```bash
git fetch origin
git switch main
git pull --ff-only

BR=feat-<topic>
WT=../redeven-official-plugins-feat-<topic>
git worktree add -b "$BR" "$WT" origin/main
```

## Dependency Boundary

- Do not use `go.work`, `go.work.sum`, `replace`, `file:`, `link:`,
  `workspace:`, `portal:`, absolute paths, relative sibling paths, local npm
  links, or Rust path overrides.
- Do not import or copy source from `../redeven` or `../redevplugin`.
- Packaging and validation must use released ReDevPlugin CLI/SDK/contract
  artifacts. The default CLI command should be a released module invocation such
  as `go run github.com/floegence/redevplugin/v3/cmd/redevplugin@v3.24.0`.
- If a plugin needs a platform capability that is not available in a released
  ReDevPlugin artifact, add and release it upstream before relying on it here.

## TDD And Local Gate

- Write or update tests before implementing behavior.
- Keep plugin source, manifest, repository index, README, tests, and generated
  release metadata semantically aligned.
- Before every commit, run:

```bash
npm test
npm run check
npm run catalog:verify
```

- Before publishing a plugin artifact, also run its package-specific build and
  the generic packager:

```bash
npm run build:<plugin-name>
node scripts/build_official_plugin.mjs <plugin-name>
```

Every `plugins/*/manifest.json` plus `release.json` pair is a discovered plugin
source. Each plugin package must expose `build`, `build:release`, `test`, and
`typecheck`; plugin-specific release work such as a canonical Worker build must
stay behind that package interface. Shared repository tags are globally unique,
must match exactly one discovered plugin, and may publish only that plugin's
exact release assets. Markets select the ordinary package in each independent plugin tag namespace.

Editable manifests use `redevplugin.source.v1` and `plugin.slug`; discovery entries
use the same slug. Neither declares a repository ID, publisher ID or full plugin ID.
Local builds run the released `build` pipeline offline. Release builds use
`build --release`, which resolves GitHub and compiles identity and bindings before
any Worker/UI build or hash. Generated files remain ignored; builds never rewrite
source or the index. Official and community plugins follow the same rule.

The generic packager builds deterministic ordinary `.redevplugin` packages using
released ReDevPlugin CLI artifacts. Publication builds through each plugin's
`build:release` script, inspects the exact package, publishes package and checksum
metadata, then downloads and verifies the exact bytes. No plugin signing inputs,
external-signer steps, trust roots, or release-reference files are used. Existing
public tags and release artifacts remain immutable history. The source repository
must not retain obsolete signing inputs merely to support old releases.

The repository index is the only discovery declaration. Market presentation comes
from the released platform package inspection. Do not create a second catalog or
invent fallback descriptions from plugin names.

## Maintained Content

- Maintained docs and comments are English.
- `dist/` is release output and must stay ignored.
- Package checksums and notices are generated by release
  scripts. Do not hand-edit artifact hashes.
- Remove obsolete test fixtures, scripts, and catalog entries in the same change
  that removes the plugin behavior they described.
- An empty `plugins/` directory and empty repository index are valid. Do not
  keep retired plugin source, release-train directories, or publication
  workflows merely to make the repository non-empty. Historical Git tags and
  immutable releases are audit evidence, not current catalog inputs.

## Presentation Authority

- Official plugin package identity and presentation evidence live only in the
  verified current package manifest. Source uses `redevplugin.source.v1` and the
  released compiler produces `redevplugin.manifest.v9`;
  do not maintain a second plugin name, Surface label, Setting label, or option
  label in catalog declarations, migration SQL, host code, or release
  automation.
- The repository index declares package locations and release namespaces only;
  package inspection remains the sole presentation source.
- The current baseline intentionally has no admission or packaging path for
  legacy manifest versions. Historical contracts remain available only from
  historical Git tags.
