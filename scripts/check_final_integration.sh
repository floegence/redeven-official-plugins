#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)
cd "$ROOT_DIR"

test -z "$(git status --porcelain)"
npm ci
npm run plugins:ci
npm run verify
git diff --exit-code
test -z "$(git status --porcelain)"
