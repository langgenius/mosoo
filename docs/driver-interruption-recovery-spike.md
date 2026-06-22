# Driver Interruption Recovery Spike

Date: 2026-06-22

## Goal

Prove the narrow path where an involuntary driver/sandbox interruption no longer leaves the viewer in an unknown loading state. The spike targets the first safe slice:

- terminal driver finalization writes a replayable viewer event;
- driver event publishing receives accepted receipts and can retry a failed batch;
- driver snapshots expose a minimal internal debug resume snapshot.

## Before

Evidence from the old code path:

- `repairFinalizedTerminalDriverRunState` only updated `session_run` and released leases.
- It did not append a `session_event`, so late or disconnected viewers had no replayable terminal event.
- driver `pushEvents` discarded API `accepted` receipts.
- `DriverEventPublisher` kept a sticky send error after one failed push.
- non-canonical draft event fallback used a random source event id, so resend was not idempotent.

Modeled 20-injection baseline:

| Metric                         |                                  Before |
| ------------------------------ | --------------------------------------: |
| infinite spinner risk          |                                   20/20 |
| viewer terminal event          |                                    0/20 |
| retry-visible interrupted turn |                                    0/20 |
| duplicate events               |                                       0 |
| lost acknowledged events       | not measurable, receipts were discarded |

State machine before:

```text
RUNNING -> socket close -> failed / stuck / viewer unknown
```

## After

Automated backend benchmark:

- Test: `apps/api/tests/driver-finalization-repair.test.ts`
- Fault injections: 20 finalized driver interruptions
- Result: passed

| Metric                         |                 After |
| ------------------------------ | --------------------: |
| infinite spinner risk          |                  0/20 |
| viewer terminal event          |                 20/20 |
| duplicate terminal events      |                     0 |
| lost acknowledged events       |                     0 |
| retry-visible interrupted turn |                 20/20 |
| interrupted-turn p95           | < 5s assertion passed |

Focused driver tests:

- `DriverEventPublisher` retries pending events after a failed send and advances `lastAcceptedSeq`.
- `DriverInstanceSocket` produces deterministic `sha256:` source ids for draft events and disambiguates duplicate drafts within one batch.
- in-process kernel/fakes now return accepted receipts instead of erasing the ORPC response.

Spike state machine covered by code:

```text
RUNNING -> socket close -> TURN_INTERRUPTED
```

Target state machine still to finish:

```text
RUNNING -> DISCONNECTED -> RESCHEDULING -> RESTORING -> READY | TURN_INTERRUPTED | RECOVERABLE_FAILED
```

## Event Sequences

Normal stream:

```text
driver pushEvents -> API persist session_event seq -> API returns accepted[{seq,type,eventId}]
-> driver records lastAcceptedSeq -> viewer receives AG-UI event
```

Kill mid-stream:

```text
socket close -> terminal finalize -> session_run failed(runtime.turn_interrupted, retryable=true)
-> append run.failed session_event(source_event_id=driver-terminal:<driver>:<run>:turn-interrupted)
-> viewer can replay mosoo.session.run.updated and stops loading
```

Cold restore, current spike:

```text
driver snapshot -> debugResume{sandboxId, lastEventSeq, recoveryMode}
```

Cold restore, fast-follow:

```text
DISCONNECTED -> RESCHEDULING event -> new sandbox/driver attach
-> replay tail after lastEventSeq -> RESTORING -> READY or TURN_INTERRUPTED
```

## Fast Follow

- Persist producer-side outbound buffer across sandbox replacement, not only within one driver process.
- Publish viewer-visible `RESCHEDULING` and `RESTORING` events with a bounded timeout and retry entry.
- Promote a product resume protocol only after real
  `DISCONNECTED -> RESCHEDULING -> RESTORING -> READY` recovery exists. Candidate fields such as
  `activeTurnState`, `nativeSessionRef`, `driverEndpoint`, and `controlPort` are intentionally out
  of scope for this spike.
- Add preview/manual gate for real sandbox kill mid-stream; current UI e2e is intentionally not trusted for this spike.
