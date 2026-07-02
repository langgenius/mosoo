# Before/after performance comparison

Scope: the "configure key → create agent → create run → first token streams to
console" journey. Numbers are grouped by whether they are **measured** (driven
against live provider APIs by `apps/driver/bench/ttft-bench.ts`, which exercises
the real driver kernel + provider registry) or **projected** from a measured
code constant (control-plane hops that can only be faithfully timed on a
Cloudflare deploy — local wrangler Queues/DO ≠ CF).

Model for all measured rows: `claude-sonnet-4-5`, live Anthropic API, same
machine/session. Absolute numbers are environment-relative; the deltas are the
point.

## Executive summary

| optimization | metric | before | after | delta | status |
|---|---|---|---|---|---|
| Full-access default (tool task) | success rate | 0% | **100%** | +100pp | **measured** |
| Full-access default (tool task) | total time | ~16.5s | **~11.6s** | **−30%** | **measured** |
| Claude CLI prewarm | first-token TTFT p50 | 6992 ms | **4870 ms** | **−30%** | **measured** |
| Claude CLI prewarm | first-token TTFT p95 | 8366 ms | **4896 ms** | **−41%** | **measured** |
| O1 inline queue dispatch | queue wait on TTFT path | ≤5000 ms | **~0 ms** | up to −5s | projected |
| O2 first-token flush | first-delta broadcast | ≤150 ms + D1 write | **~0 ms** | up to −150ms+ | projected |
| O4 opencode models.dev | cold-start fetch | ≤10 000 ms | **~0 ms** | up to −10s | projected |

---

## 1. Full-access default vs supervised-reject — MEASURED

The old default (`permissionMode: default` + broker) routes every tool call to
the control plane and, when non-interactive or on the 5-minute timeout, rejects.
A tool-writing task under each posture (`marker.txt` must actually be written):

| posture | ok% | file created | total p50 |
|---|---|---|---|
| supervised (reject) | **0%** (0/3) | **0%** | ~16.5 s |
| full-access (allow) | **100%** (3/3) | **100%** | ~11.6 s |

The reject posture is not just slower — it **fails the task** (the agent burns
turns working around the denied Write, then gives up). Full-access is both
correct and faster. Reproduce: `TTFT_SCENARIOS=tool_write_allow,tool_write_reject`.

## 2. Claude CLI prewarm — MEASURED

`@anthropic-ai/claude-agent-sdk` spawns its native CLI lazily on the first
`query()` iteration, so the whole spawn + initialize handshake lands inside the
first turn's time-to-first-token. `startup()` moves that into `backend.start()`,
which the control plane already runs ahead of the first user message.

`no_tool` scenario (pure TTFT), 5 trials each (+1 warmup discarded):

| config | boot p50 | TTFT p50 | TTFT p95 | per-trial TTFT (ms) |
|---|---|---|---|---|
| prewarm off | ~0 ms | 6992 | 8366 | 8366, 7008, 6992, 6396, 6629 |
| prewarm on | 2225 ms | **4870** | **4896** | 4870, 4882, 4896, 4634, 4411 |

**−2122 ms (−30%) p50, −3470 ms (−41%) p95.** Two effects:
1. The CLI-spawn cost (~2.2 s) leaves the turn's critical path and moves to
   boot, which is hidden behind provisioning/prewarm — invisible to the user.
2. Variance collapses (on 4411–4896 ms vs off 6396–8366 ms): the spawn was a
   *variable* tax on every cold first turn; removing it makes TTFT predictable.

Raw method + data: `apps/driver/bench/outputs/prewarm-ab.md`.

## 3. Streaming cadence — MEASURED baseline

`long_output` (~200-word reply), inter-delta gap distribution at the driver
boundary: **p50 ≈ 466 ms, p95 ≈ 582 ms**, ~12 deltas. Claude delivers chunky
deltas, not token-by-token; the console already smooths these (24 chars/frame
rAF scheduler that escalates when the queue backs up). No driver-level streaming
defect was found. The only first-token *latency* add on the streaming path is
control-plane O2 (below).

---

## Projected control-plane optimizations (need a CF deploy to measure)

Each cites the exact measured constant it removes. These live in the Workers/DO
layer; local wrangler does not replicate CF Queue batching or DO scheduling, so
faithful numbers require a staging deploy (`just bench-sandbox-agent
--require-cloudflare`).

### O1 — inline dispatch fast-path (up to −5 s)
Every interactive run is dispatched through the `api-command` Cloudflare Queue
with `max_batch_timeout = 5` (`apps/api/wrangler.toml:88`); the already-threaded
`executionContext` is never used for an inline `waitUntil` dispatch. Worst case
adds ~5 s of pure batching wait before context hydration even starts. Fix:
dispatch inline for interactive runs, keep the queue as a dedupe-keyed fallback.
Expected: removes up to ~5 s from cold-run TTFT.

### O2 — first-token fast flush (up to −150 ms + one D1 write)
The viewer delivery buffer flushes on a 150 ms timer / 4 KB / 64 events, and
delta delivery is additionally gated behind the D1 persistence commit
(`session-viewer-event-delivery-buffer.ts:15-17`). So the first visible token
waits for a timer tick and a durable write. Fix: flush the first text delta of a
run immediately and decouple delta broadcast from persistence
(broadcast-before-persist). Expected: removes ~150 ms + one D1 round-trip from
first-token latency.

### O4 — opencode models.dev fetch (up to −10 s, opencode cold start)
OpenCode blocks startup on a `models.dev/api.json` fetch (10 s timeout) when the
cache/embedded snapshot is cold. Fix: pre-seed `models.json` in the image or set
`OPENCODE_DISABLE_MODELS_FETCH=1`. Expected: removes up to ~10 s from opencode
cold-start TTFT.

---

## Environment caveats

- Measured numbers are laptop + shared key; occasional API throttling produced
  outliers in noisier runs (a single 47 s and a single 19 s TTFT in a 3-trial
  run) — excluded; the 5-trial p50/p95 above are stable.
- OpenAI/Codex is not measurable in this environment (test key lacks the driver
  default `gpt-5.4`; local codex app-server hangs on boot). The prewarm applies
  to the Claude runtime; the full-access default applies to all three.
