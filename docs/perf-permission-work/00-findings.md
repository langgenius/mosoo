# mosoo driver: full-access permissions + TTFT/streaming measurement + lifecycle — consolidated findings

Date: 2026-07-02. Evidence-first. Every claim carries a `file:line` or an external source read at source level.

## Scope (from user)

1. **Goal A — permissions**: make full-access / yolo the DEFAULT for all three runtimes (claude-agent-sdk, codex app-server, opencode ACP), like multica.
2. **Goal B — measurement + optimization**: build a measurement system; quantitatively optimize (i) time-to-first-token (TTFT) and (ii) streaming-output UX along the journey _configure provider key → create agent → create run → response streams to console_. 没有测量就没有优化.
3. **Goal C — lifecycle**: simplify/harden run lifecycle state management + state machine on that path.

Deliverable: research the reference map (15 repos), rate P0/P1/P2, then optimize → PR.

---

## Part 1 — Reference-map verdict (15 repos, all cloned & read at source level; 15/15 real)

7 P0, 5 P1, 3 P2. **Unanimous convergence on Goal A**: every P0 defaults to full-access with the same rationale — _the sandbox is the isolation boundary; do not gate per-tool-call_.

### P0 (borrow before implementing)

- **vercel-ai-harness** (`vercel/ai`: `@ai-sdk/harness` + `harness-claude-code`/`-codex`/`-opencode` + `sandbox-vercel`) — the exact architectural twin (same runtime trio). `DEFAULT_PERMISSION_MODE='allow-all'`; claude→`bypassPermissions`+`allowDangerouslySkipPermissions`; codex→`danger-full-access`+`approval never`; opencode→auto-`always`. Also: monotonic-seq bridge event log + disk mirror + resume cursor + graded recovery ladder (attach/replay → replay-from-disk → rerun); `HarnessV1StreamPart` chunk vocab with explicit text-start/delta/end ids (makes TTFT = time-to-first text-delta directly measurable); two-axis `sessionState × turnState` machine; snapshot-template prewarm; dual-signal bridge-ready race.
- **multica** (`multica-ai/multica`) — THE goal-A reference. claude `--permission-mode bypassPermissions` (pinned in a blocked-args map so user args can't override); codex via CODEX_HOME config.toml managed block (`sandbox_mode workspace-write`+`network_access true` on Linux) + JSON-RPC handlers auto-accepting every `item/*/requestApproval`; opencode `--dangerously-skip-permissions` (deliberately NOT via `OPENCODE_PERMISSION` env — key-order merge footgun). Marker-delimited idempotent managed-config block. First-turn no-progress watchdog + phase-split latency histograms.
- **openhands-sdk** (`OpenHands/agent-sdk`, arxiv 2511.03690) — `NeverConfirm()` default as a first-class discriminated-union policy object; centralized confirmation in the agent loop (not per-runtime); confirmation = durable `WAITING_FOR_CONFIRMATION` run-state pause + implicit resume via unmatched-action recovery; transient `StreamingDeltaEvent` channel (deltas to PubSub, NOT persisted; only final MessageEvent logged); ws reconnect `resend_mode all|since|null`; single execution-status enum with `is_terminal()`.
- **opencomputer** (`diggerhq/opencomputer`) — `bypassPermissions` hardcoded; two-level session-status × turn-state joined by `yield_reason`; append-only seq log with SSE `id=seq` (native `Last-Event-ID` resume) + `after=<seq>`; credential lifecycle (validate runtime/model/credential at agent-create, write-only last4, resolve+pin at run-create → no wasted boot on bad key); runtime engine pre-baked in image + `bench-launch.sh` scripted timing.
- **open-managed-agents** (`openma-ai/open-managed-agents`) — **on CF Workers+DO, same substrate**. `span.model_request_start / span.model_first_token / span.model_request_end` wire events (OMA extension) → per-call TTFT is a first-class queryable event; console `derive()` renders TTFT bars from the log; dual-port storage (canonical EventLogRepo + StreamRepo for in-flight chunks); platform-agnostic `SessionStateMachine` over one `RuntimeAdapter` port with DO-alarm orphan-turn detection; `recoverInterruptedState` pure fn (finalize orphan streams, inject placeholder tool_results so Anthropic doesn't 400); `permission_policy` default `always_allow`; one-shot POST→turn-scoped SSE that opens stream BEFORE appending user msg (kills subscribe race).
- **agentos** (`rivet-dev/agentos`) — actor≈DO. allow-all ("VM is the boundary"), only network egress scoped (default-allowlist LLM hosts); server-side auto-approve hook resolving before any client round-trip; deterministic **mock-LLM latency benchmark with committed `baseline.json` regression gate** (`--gate`/`--update-baseline`, p50/p95/p99, tolerance+noiseFloor; prompt latency excluded as LLM-bound); **"never-hit-by-normal-use" defaults audit** (stock 5s/60s/30s/64KiB timeouts that silently broke streaming); broadcast-before-persist event pump with single-pump-per-session (abort-on-replace); durable-actor/disposable-VM lazy-resume lifecycle.
- **vercel-eve** (`vercel/eve`, Apache-2.0, public June 2026) — omitted approval = `never()`; denial hygiene (unanswered → ignored/denied; splice `execution-denied` tool-result so replayed unmatched tool_use doesn't 400); durable replayable stream (`?startIndex=` cursor, auto-reconnect, bounded open-retry for the create→attach race); session/turn/step taxonomy with parked `session.waiting`; ack-then-stream API (return id instantly, stream separately); every event stamped `meta.at` → TTFT computed server-side from the log (zero console instrumentation); compensating controls (secrets at sandbox firewall, egress scoping).

### P1 (strong secondary)

- **sandboxed-issue-triage-agent** — clean TTFT instrumentation shape (in-band NDJSON `elapsedMs` stage events, run-id correlation header, client chunk timing, zero-output recovery, secret redaction). One instructive defect: no client-abort stream cancel.
- **mastra** — `@mastra/acp` defaults to inline auto-approve (`options[0]`) = the exact opencode-ACP full-access pattern; `ModelSpanTracker.completionStartTime` on first delta = TTFT; canonical chunk envelope + per-provider delta extractors + degraded-stream fallback.
- **litellm-agent-control-plane** — `bypassPermissions`+`allowDangerouslySkipPermissions` unconditional claude default; minimal starting/running/completed/failed/timed_out machine; status derived from idempotent seq+event_key log; reconciles stuck-`running` from replay; SSE tee + bounded snapshot+broadcast replay.
- **runtm** — literal `--dangerously-skip-permissions`, safety in sandbox fs/net allowlists; declarative transitions-table state machine at one chokepoint with per-state timestamps; atomic slot-reservation ownership + TTL orphan recovery; traceparent/histogram scaffolding + SSE→NDJSON framing.
- **flue** (`withastro/flue`) — real (agent-harness over pi-ai, Node + CF Workers/DO), NOT hydration. offset-resumable Durable Streams + 3s-batched delta persistence; derive-state-from-durable-history classifier; producer epoch fencing; DO stale-attempt sweep. Strong for goal C + streaming.

### P2 (marginal — do not block on)

- **codex-complexity-optimizer** — a Codex skill (regex/AST complexity scanner). NO measurement harness/timing (the hoped-for methodology doesn't exist). Borrow only: before/after report template + "heuristics are leads, measurement is proof" discipline.
- **ponytail** — a YAGNI prompt ruleset for 16 agents, not a perf/refactor tool. Only its `benchmarks/agentic/run.py` (arms×n runs, medians, rescore-from-artifacts, harvests `permission_denials` from headless `--permission-mode bypassPermissions`) is a hygiene template.
- **karpathy-skills** — one behavioral skill (Think/Simplicity/Surgical/Goal-Driven). Generic hygiene; "define numeric success criteria, loop until verified" framing only.

---

## Part 2 — mosoo current state (local, evidence)

### Permissions (all three interactive-by-default; control plane blocks yolo)

- Broker: `interactiveRequests=true` default, 5-min timeout → `reject_once`; decisions only `allow_once|reject_once`; `interactiveRequests=false` = **deny-all** (wrong for full-access). — `apps/driver/src/core/driver-permission-broker.ts:8,10,38,79-85,130-132`. Never constructed with options anywhere; no env controls it — `driver-process.ts:65`, `agent-driver-kernel.ts:152`, `bin/driver.ts:20`.
- Claude: `permissionMode:'default'` + `canUseTool`→broker; `providerOptions` CAN override mode via deep-merge (test proves `acceptEdits`) but control plane blocks it. — `apps/driver/src/runtimes/claude/agent-sdk-query-options.ts:137,35-68,132,111-116,170`.
- Codex: `approvalPolicy:'on-request'` on thread/start + thread/resume + **every** turn/start; sandbox ALREADY `danger-full-access`. Generated protocol supports `untrusted|on-failure|on-request|never` + sandbox `read-only|workspace-write|danger-full-access`. — `apps/driver/src/runtimes/openai/app-server-driver-backend.ts:35,71,178,182`, `app-server-env.ts:1`, `generated/app-server-protocol-types.ts:8-10`.
- ACP (opencode): `session/request_permission`→broker; only `allow_once/reject_once` kinds considered (`allow_always/reject_always` ignored); `session/new` carries NO permission config; driver never writes opencode.json. Child env sets `HOME=homePath` (hook point). ACP command from `MOSOO_ACP_FALLBACK_COMMAND/_ARGS`. — `acp-client-request-handler.ts:81-84,172-212,251-278`, `acp-permission-events.ts:56-68`, `acp-session-setup.ts:35-42`, `acp-configuration.ts:21-42,58-76`.
- Control plane **actively blocks** yolo: `SECURITY_BOUNDARY_SETTING_KEYS` includes `permissionMode, approval_policy, sandbox_mode, allowDangerouslySkipPermissions, default_permissions, canUseTool` → `runtime_settings_security_boundary` error. No per-agent permissionMode/approvalPolicy field in D1/GraphQL. — `pkgs/runtime-catalog/src/runtime-advanced-settings.ts:100-125,193-198`, `agent-stored-config.service.ts:28,355-358`.
- Insertion points: boot payload has `builtInTools`+`providerOptions` but no permission field — `apps/driver/src/protocol/boot/index.ts:156,162,385-396`; spec builder passes providerOptions — `runtime-driver-execution-spec.builder.ts:179-190`.
- Tests asserting current defaults: `claude-agent-sdk-query-options.test.ts:55,173`, `openai-app-server-turn-start.test.ts:15`, `driver-permission-broker.test.ts:66`, `runtime-advanced-settings.test.ts:88-96`. ACP/CMA permission fixtures also.

### Lifecycle state machines (4 layers)

1. **SessionRun** (XState + `decideSessionRunTransition`, D1 CHECK + unique active-driver lease): `queued/booting/running/waiting_input/completed/failed/cancelled/expired`. — `session-run.contract.ts:18-29`, `session-run-lifecycle.machine.ts:53-97`, `runs.schema.ts:60-70`.
2. **Session** (projection of last run status, statusSeq CAS, `repair_needed` path): `IDLE/RUNNING/RESCHEDULING/TERMINATED`. — `session.contract.ts:22`, `session-lifecycle.ts:6-24`, `session-run-write.repository.ts:531-728`.
3. **DriverInstance** (NO transition guard — ad-hoc WHERE-clause guards): `provisioning/connecting/ready/stopping/stopped/failed`. — `driver-instance-lifecycle.machine.ts:1-46`.
4. **RuntimeSubject** (full XState guard): `cold/restoring/active/backing_up/destroying/error`. — `runtime-subject-lifecycle.machine.ts:43-170`.

Known-rough:

- **Involuntary reclaim**: driver socket close → fails active run with retryable `runtime.turn_interrupted — please resend` but **nothing retries**; RESCHEDULING/120s-window is only entered by runtime _state operations_, never reclaim. Backstop = stale-run-reconciliation (heartbeat 1s, cutoff 30s) fails runs **non-retryably** — contradicts terminal-run-release's retryable:true for the same physical event. — `driver-instance/do.ts:135-166`, `terminal-run-release.ts:30-54`, `stale-run-reconciliation.service.ts:36-59`, `runtime-config.ts:7-9`.
- **Half-built ack**: driver keeps `lastAcceptedSeq` from receipts but **nothing consumes it** (grep: only debug logs); dedupe = in-memory receipts + per-batch D1 receipt read under serial gate. — `driver-event-publisher.ts:19-89`, `rpc-event-ingestion-controller.ts:65-157`.
- `session.status` redundant projection with 2 repair paths + multiple write sites = main complexity hotspot.

### Latency / measurement

- Have: `runtime.timing.recorded` phase recorder (hydration→prepare_run→provisioning→dispatch on API; driver_backend/driver_turn on driver; Claude times provider first event) — `session-runtime-timing.ts:27-110`, `driver-runtime-timing.ts:48-74`. **claude-agent-sdk emits its own `ttft_ms`/`ttft_stream_ms`/`warm_spare_claimed`.**
- Missing/broken:
  - **CF Queue hop `max_batch_timeout=5s`** on the TTFT-critical path, unmeasured; `executionContext` threaded but never used → no inline fast path. — `wrangler.toml:88-92`, `queue-run.service.ts:70-76`, `api-command-processor.ts:453-456`.
  - First delta gated behind D1-persistence-commit + ≤150ms viewer buffer; no first-token fast flush. — `session-viewer-event-delivery-buffer.ts:15-17,56-86`.
  - Each SDK delta = one ack-gated `pushEvents` RPC (throughput bound by driver→DO RTT). — `driver-event-publisher.ts:27-84`, `agent-sdk-event-writer.ts:205-218`.
  - Skill packages downloaded serially at driver-backend start (CLIs pre-baked in Dockerfile; skills are not). — `skill-materialization.ts:131,181-185`, `Dockerfile:1-43`, commit 1a857ee7.
  - Console renders 24 chars/frame (intentional smoothing latency). — `session-stream-render-scheduler.ts:20-27`.
  - No T0 accept-stage timing; ACP has zero timing; OpenAI times turn/start ack not first token; timing events have **no apps/web consumer**; traceId null in provisioning/prewarm; no inter-chunk gap metric; `pkgs/observability` has no histogram/percentile facility.
- Prewarm already exists (session-create + viewer-connect) — `create-agent-session.service.ts:338-352`, `session-viewer-socket.service.ts:57-58`, `prewarm-agent-session-runtime.service.ts`.
- Provider keys: D1 `vendor_credential` (metadata) + `vault_secret` AES-GCM envelope; injected as env vars into boot-payload JSON in the sandbox (`OPENCODE_CONFIG_CONTENT` JSON for acp-fallback). — `vendor-credential.schema.ts:12-35`, `mcp-secret-store.ts:92-176`, `hydrate-run-context.service.ts:153-192,342-382`.

---

## Part 3 — latest SDK/protocol facts (external, read at source level 2026-07-02)

### claude-agent-sdk (latest 0.3.198; `^0.3.158` resolves to it)

- `PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto'`.
- yolo = `permissionMode:'bypassPermissions'` + **required** `allowDangerouslySkipPermissions:true`. **Cannot run as root on Unix** (check Dockerfile user!). Deny rules + hooks still apply even under bypass.
- **0.3.198 warns** if `canUseTool` is set alongside `bypassPermissions`/`allowedTools` (shadowed) → must NOT pass canUseTool when bypassing.
- `dontAsk` = never prompt, deny-if-not-pre-approved, `canUseTool` never called (good "non-interactive but not-yolo" tier).
- TTFT: result carries `ttft_ms/ttft_stream_ms/time_to_request_ms/time_to_request_from_spawn_ms/warm_spare_claimed`; stream_event carries `ttft_ms`. `startup()`→`WarmQuery` prewarm (~20x faster first query). `includePartialMessages:true` for `stream_event` text deltas. MCP connects in background by default (0.3.142).
- Behavior changes to verify vs current code: 0.3.162 Grep/Glob→embedded search; native-binary spawn since 0.2.113.

### codex app-server (latest stable 0.142.5; main 0.143-alpha; **mosoo ships 0.135.0**)

- `AskForApproval` wire values are **kebab-case**: `"untrusted" | "on-request" | "never"` (+ experimental `granular`). `"on-failure"` removed on main (PR #28418, 2026-06-23) but still present/aliased in 0.142.x and 0.135.
- `thread/start.sandbox` = `SandboxMode` shorthand `"read-only"|"workspace-write"|"danger-full-access"`. `turn/start.sandboxPolicy` = full tagged union with **camelCase** `type` tags (`dangerFullAccess`, `workspaceWrite{...}`).
- **yolo** = `thread/start {approvalPolicy:"never", sandbox:"danger-full-access"}` (== CLI `--dangerously-bypass-approvals-and-sandbox`). mosoo already has the sandbox; only needs `on-request`→`never` at the 4 sites.
- Approval server→client requests (v2): `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `mcpServer/elicitation/request`. Decisions camelCase `accept|acceptForSession|decline|cancel` (v2); v1 `applyPatchApproval`/`execCommandApproval` snake_case `approved|approved_for_session|denied|abort` (deprecated). With `approvalPolicy:"never"` these effectively never fire for exec/patch.
- Streaming: `item/agentMessage/delta` (concatenate per itemId), 1:1 passthrough, **no batching**; `turn/started`→items→`turn/completed`. Built-in session-startup prewarm. `optOutNotificationMethods` capability to suppress.
- **Doc footgun**: README/site examples show camelCase `unlessTrusted`/`workspaceWrite` — STALE; generated schema + serde tests are authoritative (kebab-case for `AskForApproval`/`SandboxMode`).

### opencode over ACP (sst/opencode → now anomalyco/opencode; mosoo ships 1.17.7)

- opencode.json `permission`: keys `read/edit/glob/grep/bash/task/skill/lsp/question/webfetch/websearch/external_directory/doom_loop` + `*`; values `allow|ask|deny`; per-command/path globs; agent-level overrides.
- **yolo cleanest path**: inject config `permission:{"*":"allow"}` (or per-key) so `permission.asked` never fires → no ACP `session/request_permission` at all. `OPENCODE_CONFIG_CONTENT` env (mosoo already uses this for acp-fallback) is the injection channel. **Multica warning: do NOT use `OPENCODE_PERMISSION` env** (key-order deep-merge footgun) — use config content.
- ACP: if client doesn't implement `requestPermission`, opencode auto-**rejects** — explains why non-interactive currently blocks. Option kinds `allow_once/allow_always/reject_once` (no reject_always). ACP `session/set_mode` maps to opencode agents (could define a `yolo` agent, but config injection is simpler).
- TTFT footgun: **blocking models.dev fetch up to 10s** on cold start (`models-dev.ts:138-238`) → pre-seed `models.json` cache or `OPENCODE_DISABLE_MODELS_FETCH=1`. Built-in profiler `OPENCODE_ACP_PROFILE=1`.

### Cloudflare Sandbox SDK (GA Apr 2026, 0.8.9)

- `sleepAfter` (default 10m), `keepAlive` (heartbeat 30s, survives DO hibernation), `containerTimeouts` (instanceGet 30s, portReady 90s).
- Instance types lite→standard-4; cold start "1–3s" (image-dependent); Cloudflare pre-schedules/pre-fetches images (no user pre-warm API); **active-CPU pricing** (idle-on-LLM is free → keepAlive pool is cheap).
- **Backup/restore API** (Feb 2026 GA): `createBackup`/`restoreBackup`, restore ~2s vs ~30s fresh clone+install; COW FUSE overlay; lost on sleep (re-restore). Directory-level only (no memory snapshot yet).
- `execStream`/`startProcess`+`waitForPort`/`streamProcessLogs` for streaming; stable preview URLs via `token`.

---

## Part 4 — P0/P1/P2 optimization backlog (mosoo changes)

### Goal A — full-access defaults (P0, small, high-value)

- **A1** Claude: default `permissionMode:'bypassPermissions'` + `allowDangerouslySkipPermissions:true`; drop `canUseTool` when bypassing (0.3.198 shadow warning). Keep broker path for opt-in stricter modes. — `agent-sdk-query-options.ts:137`. **Precondition: verify Dockerfile runs driver as non-root** (bypass forbidden as root).
- **A2** Codex: `on-request`→`never` at all 4 sites (sandbox already danger-full-access). — `app-server-driver-backend.ts:35,71,178,182`.
- **A3** ACP/opencode: inject `permission:{"*":"allow"}` via `OPENCODE_CONFIG_CONTENT` (NOT `OPENCODE_PERMISSION`) so requests never fire; belt-and-braces: broker policy auto-selects allow option under full-access. — `hydrate-run-context.service.ts` (buildOpenCodeConfig) + `acp-client-request-handler.ts`.
- **A4** Broker policy layer: add a `full-access` policy evaluated BEFORE the socket round-trip → auto-allow synchronously (emit requested/resolved events for audit only). Default = full-access. — `driver-permission-broker.ts`. (openhands/agentos/OMA/eve pattern.)
- **A5** Control plane: reconcile `SECURITY_BOUNDARY_SETTING_KEYS` with the new default (either add a first-class per-agent `permissionPolicy` field so supervised mode is opt-in-able, or document that yolo is fixed). — `runtime-advanced-settings.ts`, contracts, D1.
- **A6** Update the 5 tests asserting old defaults; add tests asserting yolo defaults + opt-in supervised.
- Compensating controls (eve/agentos): keep secrets in env/firewall, scope sandbox egress — "no prompts" ≠ "no boundary".

### Goal B — measurement system (P0, required before optimizing)

- **B1** T0 accept-stage timing + stamp `queuedAtMs` on run row. — `queue-run.service.ts`.
- **B2** `queue_wait` timing event (`now - queuedAtMs`) in dispatch consumer → quantify the 5s exposure. — `api-command-processor.ts`.
- **B3** Timing parity: ACP `driver_backend`+`driver_turn` provider.first_event; OpenAI provider.first_event (not just turn/start ack). Split skill.materialize as its own phase. — `acp-driver-backend.ts`, `app-server-event-bridge.ts`, `agent-sdk-driver-backend.ts`.
- **B4** Driver publisher: per-push ack-RTT / batch size / pending-queue depth → per-run summary (chunk count, mean/p95/max inter-push gap) emitted once at run.completed (NOT per delta). — `driver-event-publisher.ts`.
- **B5** Server-side TTFT from the event log (eve pattern): first `agent.message.delta` viewer-delivery `at` − run-accept `at`; emit as timing event + wide event. — `session-runtime-timing.ts`.
- **B6** Thread real traceId (not null) in provisioning/prewarm recorders. — `runtime-driver-provisioning.service.ts`, `driver-session.service.ts`.
- **B7** Latency harness replacement: inter-chunk gap distribution per case; join runtime.timing events by runId into a per-stage waterfall; use WS path (not 2s SSE poll) or document quantization.
- **B8** Deterministic mock-provider regression gate (agentos pattern), p50/p95 per phase, `--gate`/`--update-baseline`.
- **B9** apps/web: consume `sessionRuntimeTiming` (already emitted, dropped) → per-run waterfall; `performance.mark` send→first-render. — `process-timeline.tsx`, `session-stream-socket.ts`.

### Goal B — optimizations (apply by measured bottleneck, theory-of-constraints order)

- **O1** (biggest measured): inline dispatch fast-path via `executionContext.waitUntil` for interactive runs, queue as dedupe-keyed fallback; OR a dedicated low-latency queue `max_batch_timeout=0/1`. Prove with B2. — `queue-run.service.ts`, `wrangler.toml`.
- **O2** First-token fast flush: flush the first text delta of a run immediately (like terminal-event fast flush); decouple delta viewer-delivery from D1-persistence gating (broadcast-before-persist, agentos/openhands). — `session-viewer-event-delivery-buffer.ts`.
- **O3** Claude prewarm via `startup()`/`WarmQuery` in driver boot; verify `includePartialMessages:true`. — `agent-sdk-driver-backend.ts`.
- **O4** OpenCode cold-start: pre-seed `models.json` or `OPENCODE_DISABLE_MODELS_FETCH=1` (kill ≤10s fetch). — acp config/env.
- **O5** Skill-download off the TTFT path (parallel/prewarm/cache); CF backup-restore for warm sandboxes (~2s). — driver boot + provisioning.
- **O6** "Never-hit-by-normal-use" timeout audit (agentos) across DO ws/viewer/queue caps/RPC timeouts.

### Goal C — lifecycle (P1, larger/riskier)

- **C1** Involuntary reclaim → requeue/resume (or RESCHEDULING window) instead of dead-ending at "please resend"; reconcile retryable semantics. — `terminal-run-release.ts`, `stale-run-reconciliation.service.ts`.
- **C2** Finish OR delete the ack cursor (persist `lastAcceptedSeq`, resume-from-cursor on reconnect, skip D1 receipt reads for seq≤cursor) — per prior audit, do NOT rebuild ingest. — `driver-event-publisher.ts`, ingestion controller.
- **C3** `decideDriverInstanceTransition` guard (mirror run/subject machines) → one validated chokepoint. — `driver-instance-lifecycle.machine.ts`.
- **C4** Consolidate `session.status` projection to a single write site (or derive it). — `session-run-write.repository.ts`.
- **C5** `recoverInterruptedState`-style pure fn (OMA) with in-memory-adapter unit tests → fills the zero-reclaim-tests gap.

---

## Open decision (needs user): PR scope

- **Full-access posture**: unconditional fixed default (multica) vs default-value-with-opt-in-supervised (OMA/eve/openhands). The latter needs A5 (new per-agent policy field + relax SECURITY_BOUNDARY). Recommended: default-with-opt-in.
- **PR breadth**: (i) A+B only (yolo + measurement + proven top optimizations O1/O2), shippable & low-risk; vs (ii) A+B+C (also lifecycle/reclaim), larger & riskier. Recommended: (i) first, C as follow-up.
