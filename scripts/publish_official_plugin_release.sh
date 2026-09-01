#!/usr/bin/env bash
set -euo pipefail

tag="${1:?release tag is required}"
[[ "$tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]
version="${tag#v}"
plugin=$(node scripts/resolve_release_plugin.mjs "$tag")
display_name=$(jq -r '.plugin.display_name' "plugins/$plugin/manifest.json")

if gh release view "$tag" >/dev/null 2>&1; then
  echo "release already exists for $tag" >&2
  exit 1
fi

readback=$(mktemp -d)
cleanup() {
  rm -rf "$readback"
}
trap cleanup EXIT

npm run release:prepare -- "$plugin"
npm run release:apply -- "$plugin" "releases/$plugin/$version/responses"
npm run release:finalize -- "$plugin"
npm run release:verify -- "$plugin"

output="dist/release/$plugin/$version/output"
required_assets=(
  "$output/$plugin-$version.redevplugin"
  "$output/$plugin-$version.release-ref.json"
  "$output/$plugin-$version.release.json"
  "$output/root.public.json"
)
for asset in "${required_assets[@]}"; do
  test -f "$asset"
done

mapfile -t output_files < <(find "$output" -maxdepth 1 -type f -print | sort)
((${#output_files[@]} > 0))
gh release create "$tag" "${output_files[@]}" \
  --verify-tag \
  --title "Redeven Official $display_name $tag" \
  --notes "$display_name $version with its signed ReDevPlugin release reference and public trust evidence."

gh release download "$tag" --dir "$readback"
diff -qr "$output" "$readback"
test "$(gh release view "$tag" --json isDraft,isPrerelease --jq '.isDraft or .isPrerelease')" = false
