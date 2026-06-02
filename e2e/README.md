# Local E2E Harness

This directory contains an isolated local smoke harness. It is intentionally kept outside the root workspace package list so it does not run during normal lint/typecheck/test loops.

Run from the repo root:

```bash
./e2e/run-deterministic.sh
vp run e2e:signal-contract
./e2e/run-preview-smoke.sh
./e2e/run-preview-smoke.sh --headed
./e2e/run-preview-latency.sh
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
also runs the focused collector contract test before the Playwright spec.

Required environment for Preview live harnesses:

```bash
export MOSOO_E2E_OPENAI_API_KEY=...
```

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
