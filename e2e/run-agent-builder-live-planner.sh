#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
E2E_DIR="$ROOT_DIR/e2e"
VP_BIN="$ROOT_DIR/node_modules/.bin/vp"

source "$E2E_DIR/preview-env.sh"
load_repo_env

cd "$ROOT_DIR"
exec "$VP_BIN" exec bun test --timeout 30000 apps/api/tests/agent-builder-system-agent-live.e2e.test.ts
