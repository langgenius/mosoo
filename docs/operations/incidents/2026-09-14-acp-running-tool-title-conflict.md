# 2026-09-14 — ACP Running Tool Titles Conflicted With Durable Identity

- Status: Fix deployed to staging; tenant-configuration canary pending
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
  The complete API test package passed all 988 tests.
- Native OpenCode smoke: a real shell command wrote the expected local marker;
  the prompt ended with `end_turn` and no identity constraint errors.
- The full `just check` gate passed in Linux: 2,694 tests passed, 40 skipped,
  and zero failed. This includes 1,260 Driver tests and all 988 API tests, plus
  formatting, documentation links, lint, workspace typechecks, GraphQL
  freshness, and Public API compatibility. The initial macOS run failed 11
  Linux process-supervision cases; those cases passed in Linux.
- The staging Worker and container were updated together, preserving Driver
  protocol v2. Staging health returns HTTP 200. An isolated fixture copies the
  affected Agent's published prompt, runtime, model, tools, exact Skill blob,
  and latest Environment revision. No customer Run is replayed.

The real StepFun canary is still pending an authorized test credential. Local
native execution and staging health do not establish that the complete hosted
repository-assessment workflow has recovered. Production remains unchanged.

## Remaining Actions

- [x] Pass the full repository gate on Linux.
- [ ] Complete the isolated tenant-configuration canary, including all three
      output artifacts and the Skill's artifact validator.
- [ ] Publish and review the Driver fix, then update the Mosoo submodule pin to
      the reviewed revision.
- [ ] Complete the production deploy verification runbook on the release commit.
- [ ] Deploy the reviewed release and verify a fresh canary tool call completes
      without persistence errors. Do not automatically replay the user's task.
- [ ] Attribute the remaining historical failures individually before expanding
      the confirmed incident count beyond the inspected Runs.

## Lesson

Protocol display fields must not become durable identity merely because the
first fixture keeps them constant. Keep the native progress transition and the
database invariant in the same regression path.
