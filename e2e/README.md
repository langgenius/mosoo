# Local E2E Harness

`just e2e` is the single local E2E entrypoint. The case catalog lives in
`e2e/cases.ts`, and the dispatcher lives in `e2e/cli.ts`.

Run from the repo root:

```bash
just e2e --help
just e2e contract
just e2e public-api
just e2e contract harness
just e2e contract runtime-scoreboard
just e2e deterministic session-log
just e2e ui files-page
just e2e ui preview
just e2e public-api runtime
just e2e public-api latency
just e2e public-api cold-start-ab
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

## Remote cold-start A/B

Create one private fixture per dedicated staging stack with `public-api runtime`.
Set `MOSOO_E2E_SETUP_ONLY=1`, `MOSOO_E2E_BASE_URL`,
`MOSOO_E2E_PERF_AUTH_TOKEN`, and `MOSOO_E2E_RUNTIME_FIXTURE_OUTPUT`. The fixture
contains a PAT, is written with mode `0600`, and must stay under an ignored
temporary directory.

The experiment is a fixed-stack 2×2 crossover. Phase 1 deploys A=before and
B=after; phase 2 deploys A=after and B=before. Each phase has four ABBA and four
BAAB blocks, producing 32 adjacent before/after pairs with four total rollouts:

```bash
CLOUDFLARE_ACCOUNT_ID=<staging-account-id> \
MOSOO_PERF_FIXTURE_A=.tmp/perf/fixture-a.json \
MOSOO_PERF_FIXTURE_B=.tmp/perf/fixture-b.json \
MOSOO_PERF_HOOK=e2e/bin/perf-stage-hook.ts \
MOSOO_PERF_BEFORE_ROOT=/absolute/path/to/pr54-baseline \
MOSOO_PERF_AFTER_ROOT=/absolute/path/to/candidate \
MOSOO_PERF_BEFORE_CONTAINER_INSTANCE_TYPE=basic \
MOSOO_PERF_BEFORE_CONTAINER_VCPU=0.25 \
MOSOO_PERF_BEFORE_CONTAINER_MEMORY_MIB=1024 \
MOSOO_PERF_BEFORE_CONTAINER_DISK_MB=4000 \
MOSOO_PERF_BEFORE_CONTAINER_MAX_INSTANCES=1000 \
MOSOO_PERF_AFTER_CONTAINER_INSTANCE_TYPE=basic \
MOSOO_PERF_AFTER_CONTAINER_VCPU=0.25 \
MOSOO_PERF_AFTER_CONTAINER_MEMORY_MIB=1024 \
MOSOO_PERF_AFTER_CONTAINER_DISK_MB=4000 \
MOSOO_PERF_AFTER_CONTAINER_MAX_INSTANCES=1000 \
MOSOO_PERF_A_CF_ENV=perf_a \
MOSOO_PERF_A_BASE_URL=https://perf-a.example.workers.dev \
MOSOO_PERF_A_WORKER_NAME=mosoo-api-perf-stage-a \
MOSOO_PERF_A_CONTAINER_APPLICATION_NAME=perf-container-a \
MOSOO_PERF_A_D1_DATABASE_ID=perf-d1-a \
MOSOO_PERF_A_RESOURCE_PREFIX=mosoo-perf-stage-a- \
MOSOO_PERF_A_WRANGLER_TEMPLATE=/absolute/path/to/dual-stack-wrangler.toml \
MOSOO_PERF_B_CF_ENV=perf_b \
MOSOO_PERF_B_BASE_URL=https://perf-b.example.workers.dev \
MOSOO_PERF_B_WORKER_NAME=mosoo-api-perf-stage-b \
MOSOO_PERF_B_CONTAINER_APPLICATION_NAME=perf-container-b \
MOSOO_PERF_B_D1_DATABASE_ID=perf-d1-b \
MOSOO_PERF_B_RESOURCE_PREFIX=mosoo-perf-stage-b- \
MOSOO_PERF_B_WRANGLER_TEMPLATE=/absolute/path/to/dual-stack-wrangler.toml \
MOSOO_PERF_JOURNEY=two-stage \
MOSOO_PERF_LEAD_MS=10000 \
MOSOO_PERF_MAX_ATTEMPTED_RUNS=64 \
MOSOO_PERF_MAX_FAILED_ATTEMPTS=0 \
MOSOO_PERF_MAX_USAGE_TOTAL_TOKENS=200000 \
MOSOO_PERF_MAX_WALL_CLOCK_MS=21600000 \
MOSOO_PERF_OUTPUT=.tmp/perf/cold-start-ab-v12-two-stage.json \
just e2e public-api cold-start-ab
```

`MOSOO_PERF_AUTH_TOKEN` and a Cloudflare API token (or authenticated Wrangler)
are also required but intentionally omitted above. The formal budget is frozen in
the artifact: exactly 64 remote attempts, zero failed-attempt allowance, a total
provider-token ceiling, and a six-hour wall-clock ceiling. Exhausting a budget
stops the cohort; it never reduces the planned sample or silently retries.
Before a formal cohort, run `bun e2e/bin/freeze-perf-harness.ts` and execute the
returned `runnerPath` with the returned `hookPath`. The copied judge is read-only
and carries `PERF_HARNESS_REVISION`; the runner refuses to start if its bytes no
longer match that pin. Candidate worktrees never own the evaluator.
Each two-stage run creates an empty Thread, preconnects SSE, then
sends the prompt at the absolute intent timestamp plus `MOSOO_PERF_LEAD_MS` without
`wait_for_runtime_ready`. It records intent→first-text and send→first-text. The
one-shot create-with-input journey must run as a second, independent 32-pair
cohort with `MOSOO_PERF_JOURNEY=one-shot`; the two journeys are never merged.
Each run creates a unique cattle
Thread/Sandbox/Driver/Container,
uses the same nonce inside its adjacent pair, records create/SSE Worker version
headers, captures the live Container identity and driver bundle digest after the
TTFT timestamp, and verifies logical plus physical cleanup. Schema v12 binds the
document, every execution, and every hook call to a content-addressed harness
revision; older output cannot be resumed. The two fixtures must expose identical
model, provider, runtime, and a digest of the actual published Agent/live-version
configuration. The harness also rejects any Worker, D1, Container application,
resource prefix, or base URL shared by the two physical stacks. Each run takes
all three fixed post-completion trace snapshots at approximately
0/500/1500 ms and selects the last complete snapshot without rerunning the sample.
For legacy one-shot sources only, a missing `runAcceptedAt` is recovered from the
server-generated Run ULID; two-stage/prewarm experiments remain fail-closed. A
single pending-attempt journal is
written before sampling and after sample, identity, trace, Thread deletion, and
cleanup transitions. Resume reconciles that journal before discarding and
rerunning the whole interrupted four-run block; an attempt without enough
Thread/Run identity to prove cleanup fails closed. Failed attempts retain their
sample, primary error, and cleanup evidence outside the retained result set.
Deployment intent is journaled before the remote rollout; an interrupted rollout
fails closed instead of silently creating an untracked fifth deployment.
Post-first-text tail remains diagnostic: real streaming necessarily makes it
longer than one-shot delivery. Retention instead requires total completion p95
not to regress and paired total-completion medians not to regress in either
crossover phase.
The deploy hook rebuilds Driver from each variant's source on every rollout,
rejects source mutation during build or deploy,
and records deterministic source, Worker runtime, Driver, image, and Container
provenance. README timestamps and source maps are excluded from the Worker hash;
runtime modules are not.
Each stack supplies a Wrangler template containing its own Worker, D1, R2, Queue,
DO, and Container bindings. The hook rejects a missing/mismatched target section
or an absolute `main`; it writes the validated template beside the treatment's
`apps/api`, so Worker `main` and `../driver/Dockerfile` always resolve from the
current baseline/candidate root rather than the template's source tree.
Partial four-run blocks are preserved as discarded evidence for diagnosis, but
their presence prevents retention; a formal cohort must restart cleanly. Missing
required runtime trace markers fail the
attempt immediately instead of invalidating an otherwise completed experiment
only at final summarization. A prewarm deadline miss is not missing trace evidence:
it stays in the primary intent-to-treat sample and is classified separately as a
deadline hit, late completion, or unknown outcome.

The primary endpoint is Send to the first non-empty assistant text delivered
over SSE, including samples that fail later. Intent-to-first remains a required
non-regression metric so the 10-second lead cannot hide work. The retention gate
requires after p50 Send-to-first at or below 10 seconds, at least 30 complete
pairs, at least 20% paired median improvement, a
four-run-block clustered-bootstrap 95% CI below zero, no p95/streaming/failure
regression, no p95 regression in first-text-to-completion duration for the fixed
semantic output, exact semantic output on all 64 runs, exactly two physical stacks,
both treatments on each stack, negative paired median in both phases, no pending
attempt or deployment, no failed/discarded attempt, exactly four equal-resource
rollouts, 64 unique Container Durable Objects, Driver instances, and Sandboxes,
and 64 verified cleanups. All 32 after runs must expose same-Thread prewarm outcome
evidence, at least 95% must complete before Run acceptance in the API/D1 clock
domain, and all 32 before runs must remain cold. `prepare_run.path=warm` is reported
separately as actual reuse evidence and never used to filter the primary sample.
Physical Container deployment and placement IDs remain
diagnostics because Cloudflare may reuse them across distinct cold Durable Object
runs. Each variant must also keep one
source revision, Driver bundle, image
digest, Worker runtime bundle, instance type, vCPU, memory, disk, and
maximum-instance configuration throughout retained runs. Stack and treatment
configuration digests must also remain stable. Any new deployment that
drifts from its variant's first treatment fails immediately. `usage.tokens` is
total usage rather than output tokens, so this harness does not mislabel it as
output token/s; provider output token/s is measured separately by the Driver TTFT
benchmark.

## Unmerged runtime performance overlay

The runtime performance infrastructure is intentionally maintained outside
`main`. It is not a release dependency and must never be deployed to
production. The canonical remote refs are:

| Repository                      | Remote ref                                 | Role                                      |
| ------------------------------- | ------------------------------------------ | ----------------------------------------- |
| `langgenius/mosoo`              | `origin/perf/runtime-e2e-scoreboard-infra` | Harness, Scoreboard, and API evidence     |
| `langgenius/mosoo-agent-driver` | `origin/feat/runtime-performance-evidence` | Driver identity and provider-direct bench |

Treat the refs as one overlay revision: the Mosoo ref must pin the current
Driver overlay through `apps/driver`. Fetch and verify the pair before every
experiment:

```bash
git fetch origin perf/runtime-e2e-scoreboard-infra
git worktree add --detach <before-root> origin/perf/runtime-e2e-scoreboard-infra
git -C <before-root> submodule update --init .skills/mosoo-skills apps/driver
git -C <before-root>/apps/driver fetch origin feat/runtime-performance-evidence
test "$(git -C <before-root>/apps/driver rev-parse HEAD)" = \
  "$(git -C <before-root>/apps/driver rev-parse origin/feat/runtime-performance-evidence)"
git -C <before-root> rev-parse HEAD
git -C <before-root>/apps/driver rev-parse HEAD
```

Record both printed SHAs in the experiment provenance. If the Driver equality
check fails, or the overlay does not contain the intended Mosoo target SHA,
stop and port the overlay in a focused maintenance commit before collecting
samples. Never repair or rebase the overlay during a formal run.

Create the candidate from the exact same Mosoo overlay revision:

```bash
git worktree add -b perf/runtime-e2e-candidate \
  <after-root> origin/perf/runtime-e2e-scoreboard-infra
git -C <after-root> submodule update --init .skills/mosoo-skills apps/driver
git -C <after-root> cherry-pick <mosoo-optimization-commit>...
```

For an API-only experiment, `before` and `after` must retain the same
`apps/driver` commit. For a Driver experiment, create the candidate Driver from
`origin/feat/runtime-performance-evidence`, cherry-pick only the Driver
optimization into `<after-root>/apps/driver`, and update only the candidate
Mosoo submodule pointer. Cross-repository optimization commits together form
the treatment; do not include unrelated Driver upgrades or fixes.

There are two distinct comparisons:

- Instrumentation acceptance: target Mosoo/Driver SHAs versus those same SHAs
  plus the overlay. Run only the balanced 4-pair `1/2/17/18` intrusion gate.
- Product optimization: both sides use the same overlay; only the candidate
  side adds the Mosoo and/or Driver optimization.

Before remote use, run these local gates from both roots:

```bash
just e2e contract runtime-scoreboard
just e2e contract cold-start-benchmark
bun e2e/bin/perf-intrusion-ab.ts --self-test
just tc-package @mosoo/api
```

Use only dedicated performance staging stacks. Preserve the frozen harness,
provenance, identity, trace, cleanup, and exact-output checks; missing evidence
fails closed. The 4-pair path is staging acceptance, not statistical
certification, and does not replace or modify the frozen 32-pair protocol.

## Runtime E2E scoreboard

The scoreboard reuses the frozen crossover artifact and joins provider first
delta, D1 commit, viewer publish, and browser apply evidence by Run/Session
identity. Missing stages stay `unavailable` and fail qualification instead of
being estimated.

Generate the provider-direct and browser artifacts with the same workload, then
render the joined scoreboard:

```bash
bun e2e/bin/runtime-e2e-provider-direct.ts
just e2e public-api runtime-scoreboard
bun e2e/bin/runtime-e2e-scoreboard.ts \
  .tmp/perf/runtime-browser.json \
  .tmp/perf/provider-direct.json \
  .tmp/perf/cold-start-ab-v12.json \
  .tmp/perf/runtime-scoreboard.json
```

`perf-intrusion-ab.ts` evaluates the four staging acceptance pairs
`1/2/17/18` for output, terminal state, correlation completeness, cold/warm
classification, and instrumentation overhead. This 4-pair gate is a deployment
acceptance check, not statistical certification. The frozen 32-pair crossover
and its retention gates remain unchanged.
