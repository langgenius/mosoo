# Session Lifecycle — current contract

Status: active core contract. Console and Public Thread lifecycle mutation
guards are shipped. The Public Thread summary still exposes raw runtime status
without the user-facing projection or `archivedAt`, as documented below.

This document describes the lifecycle behavior implemented today. Thread is the
product name for the backing Agent Session.

## User-visible lifecycle

Mosoo Web/Console projects storage/runtime state into three user-facing states:

| State      | Implemented condition                                                   | Product behavior                                                                                                                                                                                            |
| ---------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Alive**  | The Session is not archived and its runtime status is not `TERMINATED`. | This is a non-terminal projection, not blanket write access. `IDLE` accepts a user message; `RUNNING` keeps permission and interrupt actions but rejects another message; `RESCHEDULING` rejects new input. |
| **Asleep** | `archivedAt` is set.                                                    | Event and file mutations are blocked until explicitly unarchived. History and files remain readable, and permanent Delete remains available.                                                                |
| **Buried** | Runtime status is `TERMINATED`.                                         | The Thread is terminal, read-only, and not recoverable. Create a new Thread to continue work.                                                                                                               |

`alive`, `asleep`, and `buried` are a user-facing projection. The persisted
runtime status remains one of `IDLE`, `RUNNING`, `RESCHEDULING`, or
`TERMINATED`, and archive state is stored separately through `archivedAt`.

`alive` does not itself grant write access. `IDLE` admits a new user message.
`RUNNING` rejects another user message until the active Run finishes or is
interrupted, while pending permission decisions and user interrupt remain
available through their specific capabilities. A
`RESCHEDULING` Session stays in the non-terminal `alive` projection while its
regular mutation-capability projection is temporarily read-only; new Run admission
rejects input until the restart/recreate/reset operation completes or fails.
History, resources, and the event stream remain readable. The explicit destructive
delete action remains available and cancels/cleans up the Session rather than
waiting for the runtime operation.

The Public Thread API does not currently expose this projection: Thread summary
returns the raw four-value runtime `status` and omits `archivedAt`. Its endpoint
Thread list also includes archived rows by default, despite older OpenAPI copy
describing Archive as hiding a Thread.

## Explicit actions

### Archive

Archive is an explicit user/API action. It:

- sets the archive marker;
- blocks event and file mutations while preserving permanent Delete;
- then attempts to fail active work and close viewer/runtime connections;
- retains the Thread record, history, and files.

The marker write is the durable shipped guarantee. Cleanup steps run after that
write and are not a single database/external-resource transaction. If a later
cleanup step fails, the request can fail while the Thread remains archived and
a runtime or connection may require operator repair; retrying Archive currently
does not provide a durable cleanup-resume ledger. Archive therefore must not be
described as an atomic guarantee that active work and every connection have
already stopped.

### Unarchive

Unarchive is an explicit user/API action. It normalizes any active runtime
lifecycle state, clears the archive marker, and returns the Thread to the
resumable `alive` projection.

The Web **Follow up** action on an archived Thread is a compound explicit user
action: the client calls unarchive first and then sends the message. A raw inbound
message or `send events` request does not unarchive a Thread by itself.

### Delete

Delete is an explicit, irreversible action. It runs the Session cleanup path
and removes the Thread and its dependent records/resources. The internal and
GraphQL Session delete service treats an already-missing Session as success. The
Public Thread wrapper admits the Thread before deletion, so repeating the public
DELETE after removal currently returns `not_found`.

Console and GraphQL expose the same archive, unarchive, and delete semantics.
The Public Thread API exposes:

- `POST /api/v1/threads/{threadId}/archive`;
- `POST /api/v1/threads/{threadId}/unarchive`;
- `DELETE /api/v1/threads/{threadId}`.

Public event mutation preflights every action against the current lifecycle
before referenced draft files are claimed. Public file claim and DELETE/remove
reuse the same writable-lifecycle projection. Archived, `RESCHEDULING`, and
`TERMINATED` Threads therefore preserve readable history/files while rejecting
event and file mutation; an archived Thread must be unarchived before mutation,
and a terminated Thread cannot be resumed.

## Runtime-operation maintenance

`RESCHEDULING` is an internal restart/recreate/reset operation state, not a
generic Driver reconnect state or a fourth user-facing lifecycle state. Mosoo
allows a 120-second operation window. Successful operations return targets to
`IDLE`; failed operations attempt to restore each target's previous status.
Scheduled maintenance finds Sessions that remain in `RESCHEDULING` beyond that
window and have no active lifecycle operation, then:

1. moves the Session to `TERMINATED`;
2. fails the last active Run with `session.rescheduling_timeout` when present;
3. publishes a lifecycle termination event.

The resulting user-facing projection is `buried`.

An involuntary Driver disconnect/reclaim does not currently move the Session to
`RESCHEDULING` or enqueue a replacement Run. It fails the current Run with a
retryable error so the user/caller may explicitly retry or resend. That flag is
not an idempotency guarantee: tools may already have produced external side
effects, so Mosoo does not automatically replay the request.

## Execution snapshot

A Session records the Agent deployment version, runtime, provider, model, and
resource bindings used for execution. Publishing a newer Agent version does not
silently rewrite an existing Session's recorded execution identity.

## Not implemented or promised

The current lifecycle does not define or promise:

- automatic idle-to-dozing transitions;
- automatic archive after inactivity;
- Web/API/Channel-specific idle or archive TTL tiers;
- Agent-author configurable lifecycle TTLs;
- a five-second cold-start guarantee;
- automatic unarchive based only on a new inbound message;
- a timezone-based daily reset.

Those behaviors require a separate approved contract and implementation before
they can be documented as product behavior.
