#!/usr/bin/env bash
set -euo pipefail

tag="${1:?release tag is required}"
plugin=$(node scripts/resolve_release_plugin.mjs "$tag")
version=$(jq -r '.plugin.version' "plugins/$plugin/manifest.json")
[[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]
[[ "$tag" = "$plugin-v$version" ]]
display_name=$(jq -r '.plugin.display_name' "plugins/$plugin/manifest.json")
readback=$(mktemp -d)
trap 'rm -rf "$readback"' EXIT
if gh release view "$tag" >/dev/null 2>&1; then
  # Reconcile publication after a lost response without rebuilding or replacing assets.
  gh release download "$tag" --dir "$readback"
  test "$(find "$readback" -maxdepth 1 -type f | wc -l | tr -d ' ')" = 2
  node scripts/release_official_plugin.mjs verify "$plugin" "$readback"
  test "$(gh release view "$tag" --json isDraft,isPrerelease --jq '.isDraft or .isPrerelease')" = false
  exit 0
fi
npm run release:build -- "$plugin"
npm run release:verify -- "$plugin"
output="dist/$plugin/$version"
package="$output/$plugin-$version.redevplugin"
metadata="$output/$plugin-$version.metadata.json"
test -f "$package"
test -f "$metadata"
gh release create "$tag" "$package" "$metadata" --verify-tag \
  --title "Redeven $display_name $version" \
  --notes "$display_name $version. Install the ordinary .redevplugin package through Redeven."
gh release download "$tag" --dir "$readback"
test "$(find "$readback" -maxdepth 1 -type f | wc -l | tr -d ' ')" = 2
cmp "$package" "$readback/$plugin-$version.redevplugin"
cmp "$metadata" "$readback/$plugin-$version.metadata.json"
node scripts/release_official_plugin.mjs verify "$plugin" "$readback"
test "$(gh release view "$tag" --json isDraft,isPrerelease --jq '.isDraft or .isPrerelease')" = false
