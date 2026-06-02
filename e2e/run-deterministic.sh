#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
E2E_DIR="$ROOT_DIR/e2e"
VP_BIN="$ROOT_DIR/node_modules/.bin/vp"
PLAYWRIGHT_BIN="$E2E_DIR/node_modules/.bin/playwright"

if [[ ! -x "$PLAYWRIGHT_BIN" ]]; then
  (cd "$E2E_DIR" && "$VP_BIN" install)
fi

export MOSOO_E2E_WEB_SERVER_COMMAND="${MOSOO_E2E_WEB_SERVER_COMMAND:-$VP_BIN run --filter @mosoo/web dev}"

cd "$ROOT_DIR"
if [[ " $* " != *" --list "* ]]; then
  "$VP_BIN" run e2e:signal-contract
fi
exec "$PLAYWRIGHT_BIN" test "$@" --config e2e/playwright.config.ts e2e/session-log-deterministic.spec.ts
