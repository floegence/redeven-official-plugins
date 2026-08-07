#!/usr/bin/env bash
set -euo pipefail

tag="${1:?release tag is required}"
[[ "$tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]
version="${tag#v}"

if gh release view "$tag" >/dev/null 2>&1; then
  echo "release already exists for $tag" >&2
  exit 1
fi

previous_tag=$(jq -er '.previous_release_train_tag' plugins/containers/release.json)
previous_output=$(mktemp -d)
readback=$(mktemp -d)
cleanup() {
  rm -rf "$previous_output" "$readback"
}
trap cleanup EXIT

gh release download "$previous_tag" --dir "$previous_output"
npm run release:prepare -- containers "$previous_output"
npm run release:apply -- containers "releases/containers/$version/responses"
npm run release:finalize -- containers
npm run release:verify -- containers
npm run release:stage-capability -- containers

output="dist/release/containers/$version/output"
required_assets=(
  "$output/containers-$version.redevplugin"
  "$output/containers-$version.release-ref.json"
  "$output/containers-$version.capability-bundle.json"
  "$output/containers-$version.host-capability.pin.json"
  "$output/containers-$version.host-capability.public.json"
  "$output/root.public.json"
)
for asset in "${required_assets[@]}"; do
  test -f "$asset"
done

mapfile -t output_files < <(find "$output" -maxdepth 1 -type f -print | sort)
((${#output_files[@]} > 0))
gh release create "$tag" "${output_files[@]}" \
  --verify-tag \
  --title "Redeven Official Plugins $tag" \
  --notes "Containers $version with its signed ReDevPlugin release reference and public trust evidence."

gh release download "$tag" --dir "$readback"
diff -qr "$output" "$readback"
test "$(gh release view "$tag" --json isDraft,isPrerelease --jq '.isDraft or .isPrerelease')" = false
