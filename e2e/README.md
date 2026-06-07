# Local E2E Harness

This directory contains isolated local smoke harnesses. Most commands are invoked
explicitly so live-provider checks do not run during normal test loops unless
their required environment is present.

Run from the repo root:

```bash
./e2e/run-deterministic.sh
vp run e2e:harness-contract
./e2e/run-preview-smoke.sh
./e2e/run-preview-smoke.sh --headed
./e2e/run-preview-latency.sh
bun run e2e:agent-builder-live-planner
```

`run-deterministic.sh` is the L1 no-credential acceptance harness. It runs the
real Web route with explicit GraphQL projection fixtures, so it is safe for local
PR evidence and does not require provider keys or Worker runtime bindings. It
starts only `@mosoo/web` by default; set `MOSOO_E2E_WEB_SERVER_COMMAND` to
override the server command.

Both deterministic and Preview smoke specs attach a `runtime-signal-coverage`
artifact. The artifact is collected by `runtime-signal-collector.ts` and covers
application lifecycle, feature path execution, GraphQL/API data flow, browser
resource samples, and browser error / exception context. `run-deterministic.sh`
also runs the focused collector, Preview live env preflight, and credential
resolver contract tests before the Playwright spec.

Required environment for Preview live harnesses:

```bash
# OpenAI Runtime by default
export MOSOO_E2E_OPENAI_API_KEY=...

# or Claude Agent SDK
export MOSOO_E2E_PROVIDER=anthropic
export MOSOO_E2E_ANTHROPIC_API_KEY=...
```

The Preview live runners check these credentials before launching Playwright, so
missing-key failures return immediately without starting the local web server.
`run-preview-smoke.sh` covers the selected public runtime provider; ACP fallback
is an internal transport covered by driver fixture and API integration gates.

Agent Builder live planner smoke is an API-level provider check for the
lightweight System Agent planner. It is skipped unless both variables are set:

```bash
export MOSOO_E2E_OPENAI_API_KEY=...
export MOSOO_E2E_OPENAI_MODEL=...
bun run e2e:agent-builder-live-planner
```

Set `MOSOO_E2E_REQUIRE_LIVE_PLANNER=1` when the run must fail instead of skip if
the required variables are missing.

`run-preview-latency.sh` can target either supported live provider:

```bash
export MOSOO_E2E_PROVIDER=openai
export MOSOO_E2E_PROVIDER_API_KEY=...
# or:
export MOSOO_E2E_PROVIDER=anthropic
export MOSOO_E2E_PROVIDER_API_KEY=...
```

Optional environment:

```bash
export MOSOO_E2E_EMAIL=preview-smoke@mosoo.ai
export MOSOO_E2E_BASE_URL=http://localhost:5173
export WEB_DEV_PORT=5173
export MOSOO_E2E_LATENCY_LABEL=current
export MOSOO_E2E_LATENCY_OUTPUT=.tmp/e2e/preview-latency-current.json
```

`run-preview-latency.sh` reuses the Preview live smoke setup, then records the
elapsed time from send click to the first assistant text frame and terminal run
status for a first dispatch and a same-thread follow-up dispatch. It writes a
JSON artifact when `MOSOO_E2E_LATENCY_OUTPUT` is set.
