import { describe, expect, test } from "bun:test";

import { RUNTIME_E2E_STAGE_EVIDENCE_KEY } from "@mosoo/ag-ui-session";

import {
  attachFirstCommittedRuntimeE2EDeltaEvidence,
  markRuntimeE2EViewerPublish,
} from "../src/modules/runtime/infrastructure/performance/runtime-e2e-stage-evidence";

const runtimeEvent = {
  id: "runtime-event",
  kind: "message.delta",
  occurredAt: "2026-07-28T00:00:01.000Z",
  payload: { contentDelta: "hello", messageId: "message", role: "agent" },
  runId: "run-1",
  sessionId: "session-1",
  source: "driver",
  visibility: "all_consumers",
} as const;

describe("runtime E2E stage evidence", () => {
  test("correlates the first committed assistant delta through viewer publish", () => {
    const attached = attachFirstCommittedRuntimeE2EDeltaEvidence({
      committedSourceEventIds: ["source-1"],
      d1CommitObservedAtEpochMs: 2_000,
      runId: "run-1",
      runtimeEvents: [
        {
          event: runtimeEvent,
          occurredAt: 1_000,
          sourceEventId: "source-1",
        },
      ],
      sessionDeliveryEvents: [
        {
          event: {
            delta: "hello",
            messageId: "message",
            type: "TEXT_MESSAGE_CONTENT",
          },
          occurredAt: 1_000,
          sourceEventId: "source-1",
        },
      ],
      sessionId: "session-1",
      traceId: "trace-1",
    });
    const published = markRuntimeE2EViewerPublish(
      attached.sessionDeliveryEvents.map((record) => record.event),
      { nowEpochMs: () => 3_000, sessionId: "session-1" },
    );
    const rawEvent = published[0]?.rawEvent as Record<string, unknown>;

    expect(attached.evidenceAttached).toBeTrue();
    expect(rawEvent[RUNTIME_E2E_STAGE_EVIDENCE_KEY]).toEqual({
      correlationId: "source-1",
      d1Commit: {
        clockDomain: "api.driver-instance-do.wall",
        epochMs: 2_000,
      },
      providerFirstDelta: {
        clockDomain: "driver.event-envelope.wall",
        epochMs: 1_000,
      },
      runId: "run-1",
      schema: "mosoo.runtime-e2e-stage-evidence.v1",
      sessionId: "session-1",
      sourceEventId: "source-1",
      traceId: "trace-1",
      viewerPublish: {
        clockDomain: "api.session-do.wall",
        epochMs: 3_000,
      },
    });
  });

  test("does not attach evidence to an uncommitted delta", () => {
    expect(
      attachFirstCommittedRuntimeE2EDeltaEvidence({
        committedSourceEventIds: [],
        d1CommitObservedAtEpochMs: 2_000,
        runId: "run-1",
        runtimeEvents: [{ event: runtimeEvent, occurredAt: 1_000, sourceEventId: "source-1" }],
        sessionDeliveryEvents: [],
        sessionId: "session-1",
        traceId: null,
      }).evidenceAttached,
    ).toBeFalse();
  });
});
