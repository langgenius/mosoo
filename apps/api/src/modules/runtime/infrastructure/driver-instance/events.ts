import type { DriverCommandId, DriverInstanceId } from "@mosoo/id";
import {
  parseRuntimeEventEnvelope,
  readRuntimeEventPayload,
  readRuntimeEventString,
} from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { isTruthy } from "../../../../shared/truthiness";
import {
  applyAgUiEventToSessionLiveState,
  loadSessionViewerState,
  projectRuntimeEventToSessionDeliveryEvents,
} from "../../../sessions/application/session-live-state.service";
import type {
  SessionDeliveryEvent,
  SessionLiveState,
} from "../../../sessions/application/session-live-state.service";
import { createSessionRunTerminalSourceId } from "../../domain/session-run-terminal-event-id";
import { assertRuntimeEventMatchesDriverLink } from "./event-link-assertion";
import { createBaseLiveState, readRuntimeDriverRunTransition } from "./event-projection";
import type {
  ProjectRuntimeDriverEventsResult,
  CanonicalDriverEventEnvelope,
  ProjectedRuntimeEventRecord,
  RuntimeDriverRunTransition,
  RuntimeSessionLink,
} from "./event-types";
import { getRuntimeSessionLink } from "./session-link.repository";
export type {
  ProjectRuntimeDriverEventsResult,
  RuntimeDriverRunTransition,
  RuntimeSessionLink,
} from "./event-types";
export {
  persistProjectedRuntimeDriverEventPrerequisites,
  persistProjectedRuntimeDriverEvents,
  preflightProjectedRuntimeDriverEvents,
} from "./event-persistence";
export { getRuntimeSessionLink } from "./session-link.repository";
export {
  recordDriverInstanceCompletion,
  recordDriverInstanceFailure,
} from "./terminal-driver-events";

export async function projectRuntimeDriverEvents(
  bindings: ApiBindings,
  input: {
    assertCurrentConnection?: () => void;
    currentLiveState?: SessionLiveState | null;
    projectLiveState?: boolean;
    events: readonly CanonicalDriverEventEnvelope[];
    driverInstanceId: DriverInstanceId;
    link?: RuntimeSessionLink | null;
    provenMcpCommandIds?: ReadonlyMap<string, DriverCommandId>;
  },
): Promise<ProjectRuntimeDriverEventsResult> {
  const database = bindings.DB;
  const link = input.link ?? (await getRuntimeSessionLink(database, input.driverInstanceId));

  if (!isTruthy(link.sessionId)) {
    throw new Error("Runtime driver event session link is missing a session id.");
  }

  if (
    input.events.some((envelope) => envelope.event.kind.startsWith("run.")) &&
    !isTruthy(link.sessionRunId)
  ) {
    throw new Error("Runtime driver run event is missing a session run id.");
  }

  const projectLiveState = input.projectLiveState !== false;
  const currentLiveState = !projectLiveState
    ? createBaseLiveState({
        callerId: link.callerId,
        creatorId: link.creatorId,
        driverInstanceId: input.driverInstanceId,
        sessionId: link.sessionId,
      })
    : (input.currentLiveState ??
      (await loadStoredRuntimeLiveState(database, {
        driverInstanceId: input.driverInstanceId,
        link,
      })));

  let nextLiveState = currentLiveState;
  let liveStateChanged = false;
  let finalAssistantMessageId: ProjectRuntimeDriverEventsResult["finalAssistantMessageId"] = null;
  const runtimeEvents: ProjectedRuntimeEventRecord[] = [];
  const sessionDeliveryEvents: ProjectRuntimeDriverEventsResult["sessionDeliveryEvents"] = [];
  const transitions: RuntimeDriverRunTransition[] = [];

  function appendCanonicalEvent(
    source: CanonicalDriverEventEnvelope,
    event: RuntimeEventEnvelope,
  ): void {
    runtimeEvents.push({
      event,
      occurredAt: toDriverEventOccurredAtMs(source.occurredAt),
      provenMcpCommandId: input.provenMcpCommandIds?.get(source.eventId) ?? null,
      sourceEventId: resolveDriverEventPersistenceSourceId(source, event),
    });
  }

  function appendSessionDeliveryEvent(
    source: CanonicalDriverEventEnvelope,
    event: RuntimeEventEnvelope,
    deliveryEvent: SessionDeliveryEvent,
  ): void {
    sessionDeliveryEvents.push({
      event: deliveryEvent,
      occurredAt: toDriverEventOccurredAtMs(source.occurredAt),
      sourceEventId: resolveDriverEventPersistenceSourceId(source, event),
    });
  }

  for (const envelope of input.events) {
    input.assertCurrentConnection?.();
    const event = parseRuntimeEventEnvelope(envelope.event);
    assertRuntimeEventMatchesDriverLink(event, {
      driverInstanceId: input.driverInstanceId,
      link,
    });
    appendCanonicalEvent(envelope, event);

    if (event.kind === "runtime.resume.updated") {
      continue;
    }

    if (event.kind === "file.change.updated" || event.kind === "file.changed") {
      continue;
    }

    if (event.kind === "run.completed") {
      const payload = readRuntimeEventPayload(event);
      finalAssistantMessageId = readRuntimeEventString(payload, "finalMessageId");
    }

    const transition = readRuntimeDriverRunTransition(event);

    if (transition !== null) {
      transitions.push(transition);
    }

    if (!projectLiveState) {
      continue;
    }

    const liveEvents = projectRuntimeEventToSessionDeliveryEvents(event);

    for (const liveEvent of liveEvents) {
      nextLiveState = applyAgUiEventToSessionLiveState(nextLiveState, liveEvent);
      appendSessionDeliveryEvent(envelope, event, liveEvent);
      liveStateChanged = true;
    }
  }

  return {
    finalAssistantMessageId,
    link,
    liveStateChanged,
    nextLiveState,
    runtimeEvents,
    sessionDeliveryEvents,
    transitions,
  };
}

// Driver Contract v3 carries envelope occurredAt as an ISO 8601 string;
// persistence keeps epoch milliseconds. Unparsable or absent values stay null.
function toDriverEventOccurredAtMs(
  occurredAt: CanonicalDriverEventEnvelope["occurredAt"],
): number | null {
  if (typeof occurredAt !== "string") {
    return null;
  }

  const parsed = Date.parse(occurredAt);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveDriverEventPersistenceSourceId(
  source: CanonicalDriverEventEnvelope,
  event: RuntimeEventEnvelope,
): string | null {
  if (
    (event.kind === "run.cancelled" ||
      event.kind === "run.completed" ||
      event.kind === "run.failed") &&
    event.runId !== undefined
  ) {
    return createSessionRunTerminalSourceId(event.runId, event.kind);
  }

  return source.eventId.trim().length > 0 ? source.eventId : null;
}

async function loadStoredRuntimeLiveState(
  database: D1Database,
  input: {
    driverInstanceId: DriverInstanceId;
    link: RuntimeSessionLink;
  },
): Promise<SessionLiveState> {
  if (isTruthy(input.link.sessionId)) {
    const viewerId = input.link.callerId ?? input.link.creatorId;

    if (!isTruthy(viewerId)) {
      throw new Error("Runtime session link is missing a viewer principal.");
    }

    return loadSessionViewerState(database, {
      sessionId: input.link.sessionId,
      viewerId,
    });
  }

  return createBaseLiveState({
    callerId: input.link.callerId,
    creatorId: input.link.creatorId,
    driverInstanceId: input.driverInstanceId,
    sessionId: input.link.sessionId,
  });
}
