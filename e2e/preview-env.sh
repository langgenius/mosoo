#!/usr/bin/env bash
set -euo pipefail

preview_env_has_value() {
  local name="$1"

  [[ -n "${!name-}" ]]
}

preview_env_fail() {
  local message="$1"

  printf '%s\n' "$message" >&2
  exit 1
}

require_preview_smoke_env() {
  local provider="${MOSOO_E2E_PROVIDER:-openai}"

  case "$provider" in
    anthropic)
      if preview_env_has_value MOSOO_E2E_PROVIDER_API_KEY ||
        preview_env_has_value MOSOO_E2E_ANTHROPIC_API_KEY; then
        return
      fi

      preview_env_fail "Preview live smoke requires MOSOO_E2E_PROVIDER_API_KEY or MOSOO_E2E_ANTHROPIC_API_KEY for MOSOO_E2E_PROVIDER=anthropic."
      ;;
    openai | "")
      if preview_env_has_value MOSOO_E2E_PROVIDER_API_KEY ||
        preview_env_has_value MOSOO_E2E_OPENAI_API_KEY; then
        return
      fi

      preview_env_fail "Preview live smoke requires MOSOO_E2E_PROVIDER_API_KEY or MOSOO_E2E_OPENAI_API_KEY for MOSOO_E2E_PROVIDER=openai."
      ;;
    *)
      preview_env_fail "Preview live smoke supports MOSOO_E2E_PROVIDER=openai or MOSOO_E2E_PROVIDER=anthropic."
      ;;
  esac
}

require_preview_latency_env() {
  local provider="${MOSOO_E2E_PROVIDER:-openai}"

  case "$provider" in
    anthropic)
      if preview_env_has_value MOSOO_E2E_PROVIDER_API_KEY ||
        preview_env_has_value MOSOO_E2E_ANTHROPIC_API_KEY; then
        return
      fi

      preview_env_fail "Preview latency requires MOSOO_E2E_PROVIDER_API_KEY or MOSOO_E2E_ANTHROPIC_API_KEY for MOSOO_E2E_PROVIDER=anthropic."
      ;;
    openai | "")
      if preview_env_has_value MOSOO_E2E_PROVIDER_API_KEY ||
        preview_env_has_value MOSOO_E2E_OPENAI_API_KEY; then
        return
      fi

      preview_env_fail "Preview latency requires MOSOO_E2E_PROVIDER_API_KEY or MOSOO_E2E_OPENAI_API_KEY for MOSOO_E2E_PROVIDER=openai."
      ;;
    *)
      preview_env_fail "Preview latency supports MOSOO_E2E_PROVIDER=openai or MOSOO_E2E_PROVIDER=anthropic."
      ;;
  esac
}
