# Local E2E Harness

`just e2e` is the single local E2E entrypoint. The case catalog lives in
`e2e/cases.ts`, and the dispatcher lives in `e2e/cli.ts`.

Run from the repo root:

```bash
just e2e --help
just e2e api
just e2e contract
just e2e public-api
just e2e contract harness
just e2e deterministic session-log
just e2e ui files-page
just e2e ui preview
just e2e public-api runtime
just e2e public-api latency
just e2e api agent-builder-planner
```

The harness is grouped by layer. `just e2e <layer>` runs every case in that layer;
`just e2e <layer> <case>` runs one case.

- `cases/contract`: local harness and signal contracts.
- `cases/deterministic`: no-provider acceptance paths with fixture-backed data.
- `cases/ui`: browser journeys.
- `cases/public-api`: Public API-triggered live runtime checks.
- `cases/api`: API-level live provider checks.
- `lib`: shared E2E clients, auth helpers, setup helpers, env preflight, and runtime progress.

- `contract`: local harness and signal contracts.
- `deterministic`: no-provider acceptance paths with fixture-backed data.
- `ui`: browser journeys.
- `public-api`: Public API-triggered live runtime checks.
- `api`: API-level live provider checks.

`deterministic session-log` runs the real Web route with explicit GraphQL
projection fixtures, so it is safe for local PR evidence and does not require
provider keys or Worker runtime bindings. It starts only `@mosoo/web` by default;
set `MOSOO_E2E_WEB_SERVER_COMMAND` to override the server command.

Live provider cases require one of:

```bash
MOSOO_E2E_PROVIDER_API_KEY=...
MOSOO_E2E_OPENAI_API_KEY=...
MOSOO_E2E_ANTHROPIC_API_KEY=...
```

Use `MOSOO_E2E_PROVIDER=openai|anthropic` to choose the runtime provider.
Optional environment can live in `.env`, `MOSOO_ENV_FILE`, or
`MOSOO_E2E_ENV_FILE`.

Common optional values:

```bash
MOSOO_E2E_EMAIL=preview-smoke@mosoo.ai
MOSOO_E2E_BASE_URL=http://127.0.0.1:5173
WEB_DEV_PORT=5173
MOSOO_E2E_LATENCY_LABEL=current
MOSOO_E2E_LATENCY_OUTPUT=.tmp/e2e/preview-latency-current.json
```

Runtime signal artifacts are collected by `lib/runtime-progress.ts` and exported through
`reporter.ts`.
