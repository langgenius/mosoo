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

repo_env_default_file() {
  local root_dir

  root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  printf '%s/.env\n' "$root_dir"
}

repo_env_unquote_value() {
  local value="$1"

  if [[ "$value" == \"*\" && "$value" == *\" ]] ||
    [[ "$value" == \'*\' && "$value" == *\' ]]; then
    printf '%s\n' "${value:1:${#value}-2}"
    return
  fi

  printf '%s\n' "$value"
}

load_repo_env() {
  local env_file="${MOSOO_ENV_FILE:-${MOSOO_E2E_ENV_FILE:-}}"
  local line
  local line_number=0
  local key
  local value

  if [[ -z "$env_file" ]]; then
    env_file="$(repo_env_default_file)"
  fi

  if [[ ! -f "$env_file" ]]; then
    return
  fi

  while IFS= read -r line || [[ -n "$line" ]]; do
    line_number=$((line_number + 1))
    line="${line%$'\r'}"

    if [[ "$line" =~ ^[[:space:]]*($|#) ]]; then
      continue
    fi

    if [[ ! "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=[[:space:]]*(.*)$ ]]; then
      preview_env_fail "Invalid E2E env line $line_number in $env_file."
    fi

    key="${BASH_REMATCH[2]}"
    value="$(printf '%s' "${BASH_REMATCH[3]}" | sed 's/[[:space:]]*$//')"

    if [[ "${!key+x}" == "x" ]]; then
      continue
    fi

    value="$(repo_env_unquote_value "$value")"
    export "$key=$value"
  done <"$env_file"
}

load_e2e_env() {
  load_repo_env
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
