# 2026-09-14 — ACP Running Tool Titles Conflicted With Durable Identity

- Status: Resolved; staging and production canaries passed
- Severity: SEV-2
- Investigation window: 2026-09-14 00:00–2026-09-17 00:00 UTC
- Affected surface: OpenCode (ACP) Runs
- Public health feed: https://mosoo.ai/status.json
- Tracking issue: [#629](https://github.com/langgenius/mosoo/issues/629)

## Summary And Impact

Hosted repository-assessment Runs stopped before delivering their result. The
two attempts in #629 surfaced `runtime.turn_interrupted` without the underlying
storage error. Historical Worker logs confirm `session_event tool identity
conflict` in both attempts.

The health feed and production Run records agree on 71 failed OpenCode Runs
across September 14–16 (6, 32, and 33 per UTC day), all in one organization,
Project, and Agent. This is the investigation population, not a claim that all
71 failures have the same cause. One explicit provider content rejection is a
separate failure. The health feed's 496 API invocation failures use a different
denominator and must not be reported as 496 affected users or Runs.

## Evidence And Timeline

- September 14, 03:24:32.804 — The original #629 Driver
  `01M2EZ2E4N0X5YBG3BTZZ2RDPB` logged a D1 identity constraint error while
  persisting `tool.call.updated` events. The source event identifies Run
  `01M2EZ28DQ0Y9BDKVMT8N9BN73`.
- September 14, 04:43:13.829 — The retry Driver
  `01M2F3J84A5D2KA6SFMF3PNDV0` logged the same error for Run
  `01M2F3J0KXAX3GTECAGFYTT5JB`.
- September 14, 04:43:15.162 — The retry's shutdown log recorded reason
  `driver.command_failed.input.start`; its embedded Driver timestamp is
  04:43:11.715. Log arrival times are not a strict execution order.
- September 14, 04:43:16.209 — The retry's `runtime.run.finalized` recorded
  `status=stopped`, close code 1000, and a clean WebSocket close. The missing
  close reason alone did not establish a container crash.
- September 15, 08:19:02.141 — A separate `input.start` failure sample, Run
  `01M2J1ZGX1NRYYD574G1XKXFGZ`, logged the same D1 conflict. At 08:19:41.510,
  its command failure stack showed an ORPC `Internal server error` response.
- September 17 — A regression through the real ACP translator and session
  event persistence path reproduced the same constraint error before the fix
  and passed afterward. A native OpenCode 1.18.4 prompt then executed a local
  shell tool against a deterministic local model endpoint; its changing title
  passed the production migration's unmodified identity trigger.
- September 17, 06:17:55.142 — The first hosted canary exposed a second ingress
  path: a permission request emitted its original tool payload after updating
  normalized state. That bypassed the stable running title and reproduced the
  same D1 constraint error. A regression reproduced the failure before this
  path was corrected; both normal and permission tool updates now use the
  normalized state payload.

The three inspected production attempts used Worker version
`abdade22-3f8f-4710-af18-d89b0a826e39`.

## Root Cause

The API projects a running ACP tool's `title` into durable `tool_name`.
Migration `0008_public-thread-tool-call-identity.sql` correctly rejects a
different non-null name for the same session and Tool Call ID.

ACP titles are mutable display text. [OpenCode 1.18.4's tool projection](https://github.com/anomalyco/opencode/blob/v1.18.4/packages/opencode/src/acp/tool.ts) emits a pending shell call
with title `bash`, then changes the running title to the command when its
arguments arrive. The Driver previously forwarded both titles unchanged, so a
normal progress update looked like identity reuse. Native reproduction observed
this exact transition and the pre-fix persistence test failed on it.

The permission-request path also emits a tool progress event. Its translation
updated the tool state but discarded the normalized payload, forwarding the
permission's native title instead. The hosted canary caught this path after the
initial local regression had passed. Permission descriptions still retain the
native title; only the emitted tool identity uses the stable running title.

The [August incident](./2026-08-13-acp-tool-call-identity-conflict.md) fixed
streamed arguments and terminal display titles, but its coverage kept the
running title constant. That left the running-title transition untested.

## Fix And Verification

The ACP Driver now freezes the first running title for the call's lifetime,
falling back to its kind when no title is available. It keeps the latest native
snapshot for terminal display and clears the frozen title with the turn state.
Terminal arguments, output, and cancellation behavior remain covered by tests.
The production identity constraint and migration history are unchanged.

Verification completed:

- ACP translator lifecycle tests: 23 passed, including completion, cancellation,
  partial updates, and fresh-turn state.
- API session runtime event store tests: 16 passed, including the regression
  against the identity trigger and rejection of conflicting terminal inputs.
  The complete API test package passed all 988 tests. Permission translation
  tests passed all 20 cases, including changing native titles and parent identity.
- Native OpenCode smoke: a real shell command wrote the expected local marker;
  the prompt ended with `end_turn` and no identity constraint errors.
- The full `just check` gate passed in Linux: 2,695 tests passed, 40 skipped,
  and zero failed on the complete fix. The Linux verification container uses
  an init process to reap orphaned test subprocesses. This includes 1,261 Driver tests and all 988 API tests, plus
  formatting, documentation links, lint, workspace typechecks, GraphQL
  freshness, and Public API compatibility. The initial macOS run failed 11
  Linux process-supervision cases; those cases passed in Linux.
- The staging Worker and container were updated together, preserving Driver
  protocol v2. Staging health returns HTTP 200. An isolated fixture copies the
  affected Agent's published prompt, runtime, model, tools, exact Skill blob,
  and latest Environment revision. No customer Run is replayed.

The authorized hosted canary uses `stepfun/step-3.7-flash` through OpenRouter,
replacing the customer's direct StepFun endpoint and adding `openrouter.ai` to
the isolated environment's network allowlist. The prompt, tools, Skill content,
setup script, and remaining environment configuration are preserved. This
validates the custom OpenAI-compatible runtime path; it is not verification of
the customer's original StepFun credential or direct endpoint. The first run
failed as described above.
A subsequent attempt generated all three artifacts and ran the original Skill
validator successfully (`artifacts valid`, exit 0), completing 47 distinct tool
calls without a tool identity conflict. Its final checkpoint was rejected by
staging R2 with HTTP 403, so it is not counted as a successful Run. An earlier
attempt also disconnected with WebSocket 1006 before any model or tool call; its
underlying cause is unconfirmed.

After replacing the staging backup credential with object read/write access
limited to the two staging buckets, Run `01M2Q248W3YWP57Z0WCES0FMJQ` completed
on September 17 at 06:55:52.132 UTC. It persisted 366 tool events for 85 distinct
tool calls, committed all three artifacts, and passed the original Skill
validator both in the sandbox and after downloading the artifacts. Its durable
checkpoint `7MG8G930YJ2CKE1CA4Z07PCYSV` is `ready`. The final staging Worker
version is `2aecfc79-a83b-4889-a8c2-b451b4c47e53`.

The [Public API non-production smoke](https://github.com/langgenius/mosoo/actions/runs/35191744280)
also passed after the staging update.

## Production Release

[Driver #123](https://github.com/langgenius/mosoo-agent-driver/pull/123) and
[Mosoo #630](https://github.com/langgenius/mosoo/pull/630) were merged after
verification. Release commit `0178c2f91ac36dc19bd7b620257fcbdec6c38651` has
the same tree as reviewed main commit
`52b4cde0302de8d55d5827f3ddf9de25debf6237` and pins protocol-v2 Driver
`ab1b2290786460b88f7de25eb91efcac84bc13c5`.

The [release workflow](https://github.com/langgenius/mosoo/actions/runs/35192788811)
passed the repository gate and isolated migration-chain check, then stopped
at read-only production D1 inspection with Cloudflare authorization error 7403.
That job performed no production deployment mutation. After repeating the
production preflight with authorized Wrangler OAuth, `just deploy-api`
published the reviewed API and container at September 17, 07:12:31.846 UTC:

- Worker: `9f331765-4fda-4734-bc42-94546f20c1ef`.
- Container: `sha256:42e47522ff1eabcf7caf28c4254527754dd33de1f8e6b491172463ff1156c7dc`.
- The code release applied no database migration or secret change; Web was
  unchanged. A separate storage-credential repair followed, as described below.
- Production health, GraphQL, and homepage checks returned HTTP 200.

The first production canary, `01M2Q3E7B6EMKBWC538C9R2CXD`, stopped during
provisioning with `Network connection lost.` before any model or tool call.
Its cause is unconfirmed and it is not evidence of the title-conflict bug.
The next Run, `01M2Q3M5S1FNA09EB4Q6XWS1AR`, completed 70 distinct tool calls
and committed all three artifacts. The original Skill validator passed in the
sandbox and again after download. However, its final checkpoint failed with
R2 HTTP 403. At 07:26:20.681 UTC, log `01M2Q44R090000000000000018` records
`RuntimeSubjectCheckpointFailedError`, caused by `BackupCreateError` on the
presigned upload while persisting `run.completed`. This is a separate storage
authorization failure, not another tool identity conflict. The old credential's
exact defect is unconfirmed because its secret value is unavailable.

A new R2 credential was limited to object read/write access on the production
file and sandbox-state buckets. Upload, read, and deletion of an incident-only
probe returned HTTP 200, 200, and 204 on both buckets. With no queued or running
production Runs, the matching storage secrets were applied at 07:37:22.575 UTC.
Worker `34117295-6b55-44d9-847c-04a73b0d0a95` preserves the reviewed code and
container. Historical data and existing tokens were not deleted. The new
credential is a non-expiring user token; account-token administration is not
available to the current operator, so future removal of this Cloudflare user
must include a credential transfer.

After this storage repair, production Run `01M2Q4TH9A0AW6E2DZKP5MGCSA`
completed at 07:41:33.608 UTC on Thread `01M2Q4TGSEBC9BHX3WTKFV29NX`.
It persisted 287 tool events for 71 distinct tool calls, committed all three
artifacts, and passed the original Skill validator inside the sandbox and after
download (`artifacts valid`, exit 0). Checkpoint `7M9P6Z4CSD2R00KPD8RA34X78K`
is `ready`. The copied configuration and authorized OpenRouter route were
preserved; no original customer task was replayed.

## Remaining Actions

- [x] Pass the full repository gate on Linux.
- [x] Complete the isolated tenant-configuration canary, including all three
      output artifacts and the Skill's artifact validator.
- [x] Publish and review [Driver #123](https://github.com/langgenius/mosoo-agent-driver/pull/123),
      then pin revision `ab1b2290786460b88f7de25eb91efcac84bc13c5`.
- [x] Complete the production deploy verification preflight on the release commit.
- [x] Deploy the reviewed release, repair the independently failing checkpoint
      credential, and complete a fresh production canary with validated artifacts
      and a ready checkpoint.
- [x] Close [#629 with sanitized diagnostics and release evidence](https://github.com/langgenius/mosoo/issues/629#issuecomment-5710838467).
- [ ] Attribute the remaining historical failures individually before expanding
      the confirmed incident count beyond the inspected Runs.
- [ ] Repair the GitHub production deployment credential's Cloudflare access
      and rerun its read-only preflight.

## Lesson

Protocol display fields must not become durable identity merely because the
first fixture keeps them constant. Keep the native progress transition and the
database invariant in the same regression path.
