import {
  RUNTIME_E2E_STAGE_EVIDENCE_SCHEMA,
  readRuntimeE2EStageEvidence,
  withRuntimeE2EStageEvidence,
} from "@mosoo/ag-ui-session";
import type { AgUiSessionEvent, RuntimeE2EStageEvidence } from "@mosoo/ag-ui-session";
import { readRuntimeEventMessageDelta, readRuntimeEventMessageRole } from "@mosoo/runtime-events";

import type {
  ProjectedRuntimeEventRecord,
  ProjectedSessionDeliveryEvent,
} from "../driver-instance/event-types";

export function attachFirstCommittedRuntimeE2EDeltaEvidence(input: {
  readonly committedSourceEventIds: readonly string[];
  readonly d1CommitObservedAtEpochMs: number;
  readonly runId: string;
  readonly runtimeEvents: readonly ProjectedRuntimeEventRecord[];
  readonly sessionDeliveryEvents: readonly ProjectedSessionDeliveryEvent[];
  readonly sessionId: string;
  readonly traceId: string | null;
}): {
  readonly evidenceAttached: boolean;
  readonly sessionDeliveryEvents: readonly ProjectedSessionDeliveryEvent[];
} {
  const committedSourceEventIds = new Set(input.committedSourceEventIds);
  const firstDelta = input.runtimeEvents.find(
    (record) =>
      record.sourceEventId !== null &&
      record.occurredAt !== null &&
      committedSourceEventIds.has(record.sourceEventId) &&
      record.event.kind === "message.delta" &&
      readRuntimeEventMessageRole(record.event) === "agent" &&
      readRuntimeEventMessageDelta(record.event).length > 0,
  );

  if (
    firstDelta === undefined ||
    firstDelta.sourceEventId === null ||
    firstDelta.occurredAt === null
  ) {
    return {
      evidenceAttached: false,
      sessionDeliveryEvents: input.sessionDeliveryEvents,
    };
  }

  const evidence: RuntimeE2EStageEvidence = {
    correlationId: firstDelta.sourceEventId,
    d1Commit: {
      clockDomain: "api.driver-instance-do.wall",
      epochMs: input.d1CommitObservedAtEpochMs,
    },
    providerFirstDelta: {
      clockDomain: "driver.event-envelope.wall",
      epochMs: firstDelta.occurredAt,
    },
    runId: input.runId,
    schema: RUNTIME_E2E_STAGE_EVIDENCE_SCHEMA,
    sessionId: input.sessionId,
    sourceEventId: firstDelta.sourceEventId,
    traceId: input.traceId,
  };
  let attached = false;

  const sessionDeliveryEvents = input.sessionDeliveryEvents.map((record) => {
    if (attached || record.sourceEventId !== firstDelta.sourceEventId) {
      return record;
    }

    attached = true;
    return {
      ...record,
      event: withRuntimeE2EStageEvidence(record.event, evidence),
    };
  });

  return {
    evidenceAttached: attached,
    sessionDeliveryEvents,
  };
}

export function markRuntimeE2EViewerPublish(
  events: readonly AgUiSessionEvent[],
  input: { readonly nowEpochMs: () => number; readonly sessionId: string },
): AgUiSessionEvent[] {
  return events.map((event) => {
    const evidence = readRuntimeE2EStageEvidence(event);

    if (evidence === null) {
      return event;
    }
    if (evidence.sessionId !== input.sessionId) {
      throw new Error("Runtime E2E evidence Session does not match its viewer publish target.");
    }

    return withRuntimeE2EStageEvidence(event, {
      ...evidence,
      viewerPublish: {
        clockDomain: "api.session-do.wall",
        epochMs: input.nowEpochMs(),
      },
    });
  });
}
