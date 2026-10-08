# Thread Continuation

Status: existing isolated Thread continuation is available. The unreleased #582 candidate applies Session isolation to every new admission; verified transition of existing shared Cloud Sessions remains required.

## Why it matters

A Thread is one continuing piece of work. A follow-up must not behave differently
because it arrived ten minutes or twenty days after the previous turn, or because
mosoo recycled the execution container between those turns.

## Product contract

After execution ends, mosoo prepares the Session's complete workspace
checkpoint. The ready checkpoint record, captured provider resume cursor, and
successful Run status are committed together before admitting a follow-up or
releasing its runtime. Both the ordered completion event and terminal Driver RPC
use this boundary; pending checkpoint work remains visible as a running turn.
Missing or uncommitted native cursors reject completion. A stable cursor saved by
a previous successful turn remains valid when a runtime reuses the same native
Session ID. Follow-up admission and idle reclamation also wait for final-message
projection and completion history; their persistence retry never re-creates an
already committed workspace backup.
The next turn restores that committed state before accepting new input. Given the
same admitted configuration, Environment version, current-message attachments, and external
tool state, a warm continuation and a forced-cold continuation therefore expose the
same:

- working directory, including files outside `outputs/`, Git state, installed
  workspace dependencies, and tool-local state under the Thread directory;
- provider-native conversation and compaction cursor when the provider supplies
  one, with durable platform events remaining the replay source after the committed
  boundary; and
- pinned Agent and Environment execution plan plus the Thread's recorded artifact
  manifest.

The commit is atomic from the user's perspective. A failed checkpoint never
replaces the last successful checkpoint or publishes a successful turn. Retrying
completion can commit the turn once storage recovers. A concurrent cancellation
keeps its cancelled outcome and cannot advance the checkpoint or resume cursor.
Restore is retryable and idempotent. A missing,
expired, corrupt, or unrestorable checkpoint fails the continuation with an
actionable error instead of opening an empty workspace.

## Admitted configuration

New Sessions store the admitted inline or Agent-preset configuration alongside their execution plan,
including provider options and package-readiness state. Both cold hydration and
warm cache refresh use that saved configuration. Later Agent edits apply to new
Sessions, while provider credentials and MCP authorization are resolved again on
continuation so revoked access does not survive in a cached profile.

This configuration change does not establish the complete managed Session API or
live cold-continuation acceptance. Existing snapshots without the configuration
field retain the previous read path: published Sessions use their pinned deployment
version; unpublished Sessions use the current Agent configuration. The original
unrecorded settings of those unpublished Sessions cannot be reconstructed. Inventory
and explicit legacy treatment are required before claiming the new continuity
contract for that population or removing deployment-version storage. A present but
invalid configuration fails hydration rather than falling back to current settings.
No existing snapshot or production data is rewritten by this change.

## Rollout compatibility

Threads whose last successful turn predates the workspace-checkpoint rollout are
grandfathered: they remain admissible and a cold continuation re-materializes their
recorded ready artifacts instead of requiring a checkpoint that could not have
existed. The first successful post-rollout turn atomically marks that Thread as
checkpoint-required while committing its complete workspace. Every later successful
turn then uses the strict Run-bound admission and restore contract above.

## Retention and deletion

Formal and API-used Sessions have no recurring inactivity deadline. Continuation,
file admission, and runtime maintenance use the same Session and its committed
state even after more than 30 days. New execution plans omit the former
`recoveryRetentionMs` field; readers ignore it in historical snapshots without
rewriting stored data. Ownership, terminal lifecycle, concurrency, and committed
checkpoint requirements still apply. A missing checkpoint cannot be replaced by
an empty workspace or a new Session.

Only explicitly enrolled [Cloud debug Previews](./session-lifecycle.md#cloud-debug-preview-retention-unreleased)
have the 30-day inactivity policy. File claim and atomic Run admission share the
server-recorded input time, so a transfer admitted before Preview expiry may
finish afterward. Other admission failures can leave files attached to the
Session. The [reviewed inactive legacy cohort](./session-lifecycle.md#inactive-legacy-sessions-unreleased-migration-only)
remains a one-time read-only migration exception, not recurring formal expiry.

Keep a committed isolated Thread checkpoint restorable while the Thread exists.
Archiving does not remove it. Permanently deleting the Thread deletes its
checkpoint records and backup objects with the rest of its data. Clock-controlled
tests establish age-independent admission and restore selection, not actual
multi-day live survival or the storage provider's retention behavior.

## Security and isolation boundaries

The checkpoint belongs to exactly one Project and Session; an Agent is optional configuration provenance. It is never searched
or restored by path alone and is never shared with another Thread or tenant.
Checkpoint creation and restoration remain auditable runtime operations.

The durable checkpoint does not contain:

- short-lived provider, proxy, boot, or mount credentials; these are resolved from
  Credential / Vault again for each runtime;
- the read-only attachment mount, because only attachments selected for the current
  message may be injected;
- live processes, sockets, an in-memory kernel, or machine-wide temporary state; or
- Agent-level state that could cross the Task Thread boundary.

Re-created processes may rebuild disposable machine caches, but the restored Thread
working directory is the authoritative continuation state.

## Legacy shared workspaces

Existing shared Agent workspaces remain readable and continuable through the legacy binding until their Cloud transition is verified. New Sessions never select that shared binding, even when their preset retains a historical Pet label. Migration must preserve each existing Session's identity, context and promised files. See [Session isolation](./agent-type.md) for the transition and the separate Cloud Preview inactivity policy.
