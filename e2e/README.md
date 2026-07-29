# Local E2E Harness

`just e2e` is the single local E2E entrypoint. The case catalog lives in
`e2e/cases.ts`, and the dispatcher lives in `e2e/cli.ts`.

Run from the repo root:

```bash
just e2e --help
just e2e contract
just e2e public-api
just e2e contract harness
just e2e deterministic session-log
just e2e ui files-page
just e2e ui preview
just e2e public-api runtime
just e2e public-api latency
```

The harness is grouped by layer. `just e2e <layer>` runs every case in that layer;
`just e2e <layer> <case>` runs one case.

- `cases/contract`: local harness and signal contracts.
- `cases/deterministic`: no-provider acceptance paths with fixture-backed data.
- `cases/ui`: browser journeys.
- `cases/public-api`: Public API-triggered live runtime checks.
- `lib`: shared E2E clients, auth helpers, setup helpers, env preflight, and runtime progress.

`deterministic session-log` runs the real Web route with explicit GraphQL
projection fixtures, so it is safe for local PR evidence and does not require
provider keys or Worker runtime bindings. It starts only `@mosoo/web` by default;
set `MOSOO_E2E_WEB_SERVER_COMMAND` to override the server command.

Each live case requires a key matching `MOSOO_E2E_PROVIDER` (or the generic
`MOSOO_E2E_PROVIDER_API_KEY`):

```bash
MOSOO_E2E_PROVIDER_API_KEY=...
MOSOO_E2E_OPENAI_API_KEY=...
MOSOO_E2E_ANTHROPIC_API_KEY=...
MOSOO_E2E_OPENCODE_API_KEY=...
MOSOO_E2E_DEEPSEEK_API_KEY=...
```

`ui preview` and `public-api latency` support `openai|anthropic`.
`public-api runtime` supports `openai|anthropic|opencode|deepseek`. Omitting
`MOSOO_E2E_PROVIDER` selects `openai`, so an unrelated DeepSeek/OpenCode key does
not satisfy preflight.
Optional environment can live in `.env`, `MOSOO_ENV_FILE`, or
`MOSOO_E2E_ENV_FILE`.

`MOSOO_E2E_PROVIDER=deepseek` is supported by the `public-api runtime` case. It creates an
official DeepSeek credential and runs the DeepSeek preset through the OpenCode ACP fallback
runtime:

```bash
MOSOO_E2E_RUNTIME_ID=acp-fallback
MOSOO_E2E_DEEPSEEK_API_KEY=...
MOSOO_E2E_DEEPSEEK_BASE_URL=https://api.deepseek.com
MOSOO_E2E_DEEPSEEK_MODEL=deepseek-v4-pro
```

Use `MOSOO_E2E_OPENCODE_API_KEY` only for the OpenCode Zen provider. DeepSeek official keys must use
`MOSOO_E2E_DEEPSEEK_API_KEY` or the generic `MOSOO_E2E_PROVIDER_API_KEY` with
`MOSOO_E2E_PROVIDER=deepseek`.

Common optional values:

```bash
MOSOO_E2E_EMAIL=preview-smoke@mosoo.ai
MOSOO_E2E_BASE_URL=http://127.0.0.1:5173
WEB_DEV_PORT=5173
MOSOO_E2E_RUNTIME_ID=openai-runtime
MOSOO_E2E_LATENCY_LABEL=current
MOSOO_E2E_LATENCY_OUTPUT=.tmp/e2e/preview-latency-current.json
```

Runtime signal artifacts are collected by `lib/runtime-progress.ts`.

## Runtime performance overlay

The Runtime E2E Scoreboard and frozen performance harness are intentionally
maintained outside `main`, so their probes cannot affect the production
runtime. Treat these remote refs as one staging-only overlay:

| Repository                      | Remote ref                                 |
| ------------------------------- | ------------------------------------------ |
| `langgenius/mosoo`              | `origin/perf/runtime-e2e-scoreboard-infra` |
| `langgenius/mosoo-agent-driver` | `origin/feat/runtime-performance-evidence` |

The Mosoo ref pins the paired Driver revision through `apps/driver`. Follow the
[canonical overlay instructions](https://github.com/langgenius/mosoo/blob/perf/runtime-e2e-scoreboard-infra/e2e/README.md#unmerged-runtime-performance-overlay)
for disposable worktrees, provenance, validation, and staging cleanup.

The minimum checkout and identity check is:

```bash
git fetch origin perf/runtime-e2e-scoreboard-infra
PERF_OVERLAY_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/mosoo-perf-overlay.XXXXXX")"
git worktree add --detach \
  "$PERF_OVERLAY_ROOT/before" origin/perf/runtime-e2e-scoreboard-infra
git -C "$PERF_OVERLAY_ROOT/before" \
  submodule update --init .skills/mosoo-skills apps/driver
git -C "$PERF_OVERLAY_ROOT/before/apps/driver" \
  fetch origin feat/runtime-performance-evidence
test "$(git -C "$PERF_OVERLAY_ROOT/before/apps/driver" rev-parse HEAD)" = \
  "$(git -C "$PERF_OVERLAY_ROOT/before/apps/driver" \
    rev-parse origin/feat/runtime-performance-evidence)"
```

For instrumentation acceptance, compare target Mosoo/Driver SHAs with those
same SHAs plus the overlay. For product experiments, both sides must use the
same overlay and only the candidate may add the Mosoo and/or Driver
optimization. An API-only candidate must keep the Driver submodule identical
on both sides.

Use dedicated performance staging only; never deploy the overlay to production.
Missing provenance or stage evidence fails closed. The balanced 4-pair
`1/2/17/18` run is staging acceptance, not statistical certification, and does
not modify or replace the frozen 32-pair protocol.
