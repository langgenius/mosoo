# 2026-08-13 — ACP Tool Calls Failed On Streamed Identity Conflict

- Status: Resolved
- Severity: SEV-2
- Window: 2026-08-13 16:24–18:47 UTC
- Affected surface: OpenCode (ACP) runtime through UI and Public API Runs
- Public status update: https://mosoo.ai/status
- Tracking PR: [#534](https://github.com/langgenius/mosoo/pull/534)

## Summary And Impact

ACP Runs that used tools could fail before the tool completed. Users saw a
generic `acp.turn_failed` internal server error instead of an assistant result.

Production records show eight matching user-facing Run failures across two
accounts and three Agents. The account count does not identify the number of
individual users. Separate provider `insufficient balance` failures that shared
the top-level `acp.turn_failed` code are excluded from this incident.

## Timeline

- 16:24 — The first matching user-facing ACP Run failed.
- 17:22 — The last matching pre-fix Run failure was recorded.
- 18:24 — The hotfix was committed after reproducing the reported Skill and
  tool path in a production-shaped staging environment.
- 18:32 — [#534](https://github.com/langgenius/mosoo/pull/534) merged.
- 18:40 — The API hotfix reached production.
- 18:47 — The first post-deploy user-facing ACP Run completed. No later
  matching identity-conflict failure was recorded through 2026-08-17.

## Root Cause

Migration `0008_public-thread-tool-call-identity.sql` correctly rejected reuse
of a durable tool-call identity with different immutable data. ACP providers,
however, stream tool arguments as evolving snapshots, including incomplete JSON
objects. The API persisted every running snapshot as if its tool input were
already immutable. A later snapshot for the same Tool Call ID then looked like
identity reuse, so D1 raised a `session_event tool identity conflict` and the
Run surfaced `acp.turn_failed`.

The test and release path had verified stable terminal tool events, but had not
exercised evolving ACP argument snapshots against the production D1 identity
constraint.

## Detection And Response

A user report on a Skill-loading path initiated the investigation. The public
Run error exposed only `acp.turn_failed`, so production-shaped staging and the
session-event write path were needed to isolate the D1 identity conflict. The
hotfix kept the stable tool name while a call was running and delayed canonical
tool input persistence until the terminal snapshot was authoritative.

## Corrective Actions

- [x] Runtime team — persist canonical ACP tool input only at terminal state —
      2026-08-13
- [x] Runtime team — keep terminal display titles out of durable tool identity —
      2026-08-13
- [x] Runtime team — add regression coverage for evolving tool arguments and
      the durable identity constraint — 2026-08-13
- [x] Runtime team — verify the reported Skill and tool path on isolated,
      production-shaped staging — 2026-08-13

## Lessons

A streamed snapshot is mutable until the protocol marks it terminal. Durable
identity checks must use fields that are stable for the whole Tool Call, while
canonical input belongs to the terminal event. A generic runtime error is not
enough to distinguish a storage-contract failure from an upstream provider
failure, so incident analysis must preserve the lower-level cause.
