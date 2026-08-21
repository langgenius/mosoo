# Thread Continuation

Status: available for Task Agents, with the boundaries below.

## Why it matters

A Thread is one continuing piece of work. A follow-up must not behave differently
because it arrived ten minutes or twenty days after the previous turn, or because
mosoo recycled the execution container between those turns.

## Product contract

After a turn completes successfully, mosoo commits the Task Agent's complete
Thread working directory and provider resume state before admitting a follow-up
or releasing its runtime.
The next turn restores that committed state before accepting new input. Given the
same Agent version, Environment version, current-message attachments, and external
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
replaces the last successful checkpoint and blocks follow-up admission until the
completed turn is committed. Restore is retryable and idempotent. A missing,
expired, corrupt, or unrestorable checkpoint fails the continuation with an
actionable error instead of opening an empty workspace.

## Rollout compatibility

Threads whose last successful turn predates the workspace-checkpoint rollout are
grandfathered: they remain admissible and a cold continuation re-materializes their
recorded ready artifacts instead of requiring a checkpoint that could not have
existed. The first successful post-rollout turn atomically marks that Thread as
checkpoint-required while committing its complete workspace. Every later successful
turn then uses the strict Run-bound admission and restore contract above.

## Retention and deletion

A committed Task Thread checkpoint remains restorable for at least 20 days while
the Thread exists. Archiving does not remove it. Permanently deleting the Thread
deletes its checkpoint records and backup objects with the rest of the Thread's
data.

## Security and isolation boundaries

The checkpoint belongs to exactly one App, Agent, and Thread. It is never searched
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

## Assistant Agent distinction

Task Agent durability is Thread-scoped isolation, not shared memory. Assistant
Agents may additionally preserve selected Agent-level memory and allow multiple
Threads to share a stable Sandbox. A Task Agent never receives another Thread's
checkpoint, even when both Threads use the same Agent.
