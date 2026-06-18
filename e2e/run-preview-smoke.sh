#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
E2E_DIR="$ROOT_DIR/e2e"
VP_BIN="$ROOT_DIR/node_modules/.bin/vp"
PLAYWRIGHT_BIN="$E2E_DIR/node_modules/.bin/playwright"

source "$E2E_DIR/preview-env.sh"
load_repo_env
require_preview_smoke_env

if [[ ! -x "$PLAYWRIGHT_BIN" ]]; then
  (cd "$E2E_DIR" && "$VP_BIN" install)
fi

cd "$ROOT_DIR"
exec "$PLAYWRIGHT_BIN" test "$@" --config e2e/playwright.config.ts e2e/preview-smoke.spec.ts
