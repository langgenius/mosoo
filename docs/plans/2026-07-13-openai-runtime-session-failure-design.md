# OpenAI Runtime Pre-Start Failure Repair

## Decision

Repair the user-visible failure at three existing boundaries without expanding
the GraphQL or D1 schema:

1. Fail the Driver image build when the bundled Codex runtime cannot start.
2. Persist one canonical `run.failed` process event when Driver terminal and
   dispatch provisioning failure paths race.
3. Project a terminal event received before `run.started` as a terminal Turn
   instead of leaving it in a provisional Pending Turn.

`apps/driver` remains the runtime-image owner. The API remains the canonical
Run/event owner. The Web projection remains responsible only for grouping
persisted process events into Turn cards.

## Driver Image

Add `codex --version` and `codex app-server --help` to the same Docker `RUN`
that installs native runtime packages. This invalidates the poisoned cache
layer and makes a missing platform optional package fail closed. Mirror the
smoke in Driver CI and lock the Dockerfile contract with a focused test.

Do not hardcode `@openai/codex-linux-x64`: the same Dockerfile supports arm64
local builds, and Codex already owns the platform-to-package mapping.

## Canonical Run Failure

Introduce one application service that ensures the canonical failed Run event
after a status compare-and-set:

- Read the persisted Run after either producer attempts its status update.
- Emit only when the persisted terminal status is `failed` and carries an
  error.
- Build the payload from the persisted winning error, not the losing caller's
  local error.
- Use one stable source event identity for both producers so the existing
  `(session_id, source_event_id)` uniqueness rule provides idempotency and
  repair semantics.

The after-terminal path must not simply stop writing: it is also the repair
path when the status update succeeded but the first event append did not.

## Pre-Start Turn Projection

Keep the current event contract. When no Turn is active and a terminal event
arrives, close the accumulated provisional events into a terminal Turn. Normal
`run.started` grouping and genuinely unmatched trailing events remain
unchanged.

Do not deduplicate by adjacent text or timestamp in the Web layer; without a
`runId` that can delete real independent events.

## Verification

- Red/green focused tests for the Driver artifact contract, both API race
  orders plus repair/idempotency, and orphan terminal Turn grouping.
- Driver/API/Web typechecks and relevant package tests.
- No-cache linux/amd64 Driver image build and container-level Codex smoke.
- Recreate only the local Sandbox, then run the configured OpenAI Agent twice
  in the same Session and verify one successful terminal event per Run.
- `just graphql-codegen` and DB generation are not applicable because the
  cross-boundary schema and D1 schema do not change.
