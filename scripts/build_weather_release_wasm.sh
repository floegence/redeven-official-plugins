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
  'rust:1.88-bookworm@sha256:af306cfa71d987911a781c37b59d7d67d934f49684058f96cf72079c3626bfe0' \
  bash -c 'rustup target add wasm32-unknown-unknown >/dev/null && cargo build --locked --release --target wasm32-unknown-unknown && cp /tmp/redevplugin-weather-target/wasm32-unknown-unknown/release/redeven_official_weather_worker.wasm "/out/$1"' \
  -- "$output_name"

test -s "$output"
