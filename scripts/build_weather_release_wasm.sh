#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
repo_root=$(cd "$script_dir/.." && pwd -P)
output="${1:?canonical Weather WASM output path is required}"

case "$output" in
  "$repo_root"/dist/release/weather/*) ;;
  *)
    echo "canonical Weather WASM output must stay under dist/release/weather" >&2
    exit 2
    ;;
esac

output_dir=$(dirname "$output")
output_name=$(basename "$output")
mkdir -p "$output_dir"

docker run --rm --platform linux/amd64 \
  --volume "$repo_root:/src:ro" \
  --volume "$output_dir:/out" \
  --workdir /src/plugins/weather/worker \
  --env CARGO_TARGET_DIR=/tmp/redevplugin-weather-target \
  'docker.io/library/rust:1.98.0-bookworm@sha256:4e4a7e7939c17991ab35f2b8c2e67593980f771d28f6b1254b1850f860fd0c7f' \
  bash -c 'rustup target add wasm32-unknown-unknown >/dev/null && cargo build --locked --release --target wasm32-unknown-unknown && cp /tmp/redevplugin-weather-target/wasm32-unknown-unknown/release/redeven_official_weather_worker.wasm "/out/$1"' \
  -- "$output_name"

test -s "$output"
