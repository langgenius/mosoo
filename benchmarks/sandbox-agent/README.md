# Sandbox Agent Benchmark Manual

This benchmark targets the hybrid deployment used by this fork:

- Local Mosoo control plane: the Mosoo Web/API service runs on this machine.
- Cloudflare execution plane: Workers, Durable Objects, Containers, and Sandbox run in the configured Cloudflare account.
- Benchmark path: local Mosoo API accepts the request, then the Agent runtime executes through the Cloudflare online sandbox path.

The benchmark Agent should stay intentionally simple: use the default Agent shape, configure exactly one working runtime, publish it, and avoid Skills, MCP servers, Spaces, channel bindings, or custom files. This keeps the measurement focused on dispatch success and latency instead of Agent complexity.

## Quick Start

Start local Mosoo first:

```bash
just dev
```

Prepare credentials:

```bash
export MOSOO_BENCH_BASE_URL=http://127.0.0.1:8787
export MOSOO_BENCH_AGENT_ID=01J...
export MOSOO_BENCH_PAT=mst_...
```

Or put those values in a local root `.env`; this file is ignored by git and is loaded
automatically when present.

Run preflight:

```bash
just bench-sandbox-agent-preflight
```

Run the default benchmark set:

```bash
just bench-sandbox-agent --repeat 3 --concurrency 1
```

Run the public-benchmark-inspired suite:

```bash
just bench-sandbox-agent --suite benchmark_lite --repeat 1 --concurrency 1
```

Run the default runtime/API checks plus the benchmark-inspired suite:

```bash
just bench-sandbox-agent --suite full --repeat 1 --concurrency 1
```

Artifacts are written under `outputs/sandbox-agent-bench/<run-id>/` by default:

- `results.json`: full machine-readable result set.
- `results.csv`: spreadsheet-friendly row data.
- `summary.md`: filled run summary.

## Required Authentication

The script starts with an interactive preflight when required values are missing.

| Credential       | Required                       | Why It Is Needed                                                                           | How To Provide                                  |
| ---------------- | ------------------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Mosoo base URL   | yes                            | Points the harness at the local API Worker.                                                | `MOSOO_BENCH_BASE_URL` or prompt.               |
| Agent ID         | yes                            | Selects the published simple Agent under test.                                             | `MOSOO_BENCH_AGENT_ID` or prompt.               |
| Mosoo PAT        | yes                            | Calls the Public Thread API.                                                               | `MOSOO_BENCH_PAT` or hidden prompt.             |
| Docker daemon    | local API only                 | Local `wrangler dev --local` uses Docker-backed Sandbox/Container execution.               | Start Docker Desktop before running.            |
| Cloudflare login | optional by default            | Lets the operator confirm Worker/Sandbox account visibility.                               | `wrangler login`, then `wrangler whoami`.       |
| Provider API key | not used by the default runner | The simple Agent must already have a working runtime credential configured in local Mosoo. | Configure it in Mosoo Providers before running. |

Use `--non-interactive` in CI. Missing required values fail fast and print the exact environment variables to set.

## Useful Commands

```bash
# Check local Mosoo, PAT, Agent, CLI, and optional Wrangler identity.
just bench-sandbox-agent-preflight

# Run defaults once.
just bench-sandbox-agent

# Run benchmark-inspired cases only.
just bench-sandbox-agent --suite benchmark_lite

# Run defaults plus benchmark-inspired cases.
just bench-sandbox-agent --suite full

# Repeat each default scenario 5 times with two concurrent cases.
just bench-sandbox-agent --repeat 5 --concurrency 2

# Run only one scenario.
just bench-sandbox-agent --scenario smoke_first_turn

# Include the optional interrupt scenario.
just bench-sandbox-agent --scenario interrupt_run

# Make Cloudflare account visibility mandatory.
just bench-sandbox-agent-preflight --require-cloudflare

# CI mode.
just bench-sandbox-agent --non-interactive --repeat 3 --concurrency 1
```

## Reading Results

Use these fields first:

- `success`: whether the case produced the expected signal.
- `createThreadMs`: local API acceptance time for create-thread scenarios.
- `sendEventAcceptedMs`: local API acceptance time for follow-up or interrupt events.
- `firstAssistantTextMs`: time until the first non-empty Agent message event.
- `tokenCompletedMs`: time until the expected token is observed.
- `completedMs`: time until a terminal run status is observed after the token.
- `terminalRunStatus`: terminal run status if observed.

Suites:

- `default`: six runtime/API scenarios that keep the Agent simple and measure dispatch, sandbox startup, streaming, follow-up, structured output, long input, and Thread lifecycle behavior.
- `benchmark_lite`: nine public benchmark-inspired prompts covering MMLU-style knowledge, GPQA-style science reasoning, GSM8K-style arithmetic, HumanEval/MBPP-style coding, SWE-bench-style patch reasoning, BFCL-style function-call planning, IFEval-style instruction constraints, and structured extraction.
- `full`: `default` plus `benchmark_lite`.

The `benchmark_lite` suite is intentionally not a formal reproduction of those public
leaderboards. It uses compact original prompts and deterministic token scoring so this
harness can keep measuring sandbox execution success and latency. Treat the score as a
Mosoo sandbox regression signal, not as a comparable public model score.

Layer attribution:

- Fast create/send acceptance but slow first text usually points to Cloudflare scheduling, sandbox boot, runtime startup, or model latency.
- Slow create/send acceptance points to local Mosoo API, D1, queueing, or request handling.
- Missing token with terminal `failed` points to runtime/provider failure; inspect the trace in `results.json`.
- Local health failures mean fix local Mosoo before interpreting sandbox performance.

## Troubleshooting

If preflight reports `PAT and Agent access` with `HTTP 404`, first check:

- The Agent ID is the actual Agent ID from the local Mosoo service you are benchmarking.
- The Agent has been published; draft Agents are not visible through the Public Thread API.
- The PAT was created by the same local Mosoo account that owns the Agent's App.
- You are pointing at the local API origin for this checkout, usually `http://127.0.0.1:8787`.

If all benchmark cases fail with `runtime.provision_failed` or fail before producing
any assistant text, check Docker first. In local development, the Mosoo Worker is
served by `wrangler dev --local`, and the Sandbox/Container path depends on Docker
Desktop being fully running.

If thread creation returns `409 readiness_blocked` with `Provider error: timeout`,
the Agent is reachable but its configured provider/model is not ready. Reconnect or
replace the App's default provider credential, or publish the simple Agent with a
model that the provider can probe within the readiness timeout.

## Safety

- The default scenarios create benchmark Threads and one lifecycle case deletes its own Thread.
- The runner does not create, update, publish, or delete Agents.
- The runner does not store secrets in reports; it records only present/missing/masked state.
- Keep concurrency low first. Raise `--concurrency` only after a stable baseline.
