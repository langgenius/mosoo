import {
  EventType,
  MOSOO_CUSTOM_EVENT,
  createServerCustomEvent,
  parseNullableSessionUsageSummary,
} from "@mosoo/ag-ui-session";
import type { DriverEventEnvelope } from "@mosoo/agent-driver/events";
import type { DriverInstanceId } from "@mosoo/id";
import {
  createRuntimeEvent,
  parseRuntimeEventEnvelope,
  readRuntimeEventPayload,
  readRuntimeEventPermissionRequest,
  readRuntimeEventString,
  readRuntimeRunPayload,
} from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";

import { logInfo } from "../../../../platform/cloudflare/logger";
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
import { getRuntimeKindPolicy } from "../../domain/runtime-kind-policy";
import { createSessionRunTerminalFailureSourceId } from "../../domain/session-run-terminal-event-id";
import { upsertNativeResumeRef } from "../native-resume-ref.repository";
import { getSessionRunBudgetFailure } from "../session-runs/session-run-budget.repository";
import {
  assertRuntimeEventMatchesDriverEnvelope,
  assertRuntimeEventMatchesDriverLink,
} from "./event-link-assertion";
import {
  createBaseLiveState,
  normalizeRuntimeSessionInfoTitle,
  readPermissionRequestViews,
  readRuntimeDriverRunTransition,
  removePermissionRequest,
  upsertPermissionRequest,
} from "./event-projection";
import type {
  ProjectedRuntimeEventRecord,
  ProjectRuntimeDriverEventsResult,
  RuntimeDriverRunTransition,
  RuntimeSessionLink,
} from "./event-types";
import { readNativeResumeRef } from "./native-resume-ref-event";
import {
  recordRuntimeFileChanges,
  recordRuntimeSessionOutputDirectory,
} from "./runtime-session-output-store";
import { getRuntimeSessionLink } from "./session-link.repository";
export type {
  ProjectRuntimeDriverEventsResult,
  RuntimeDriverRunTransition,
  RuntimeSessionLink,
} from "./event-types";
export { persistProjectedRuntimeDriverEvents } from "./event-persistence";
export { getRuntimeSessionLink } from "./session-link.repository";
export {
  recordDriverInstanceCompletion,
  recordDriverInstanceFailure,
} from "./terminal-driver-events";

function readTerminalPendingToolResult(event: RuntimeEventEnvelope): string | null {
  if (event.kind === "run.failed") {
    const run = readRuntimeRunPayload(event).run;
    const message = run?.error?.message ?? "Run failed before the tool returned a result.";
    return `Tool failed before returning a result: ${message}`;
  }

  if (event.kind === "run.cancelled") {
    return "Tool was cancelled before returning a result.";
  }

  return null;
}

function createPendingToolResultEvents(
  state: SessionLiveState,
  event: RuntimeEventEnvelope,
): SessionDeliveryEvent[] {
  const content = readTerminalPendingToolResult(event);

  if (content === null) {
    return [];
  }

  return state.messages.flatMap((message) => {
    const completedToolCallIds = new Set(
      message.segments.flatMap((segment) =>
        segment.kind === "tool_result" ? [segment.toolCallId] : [],
      ),
    );

    return message.segments.flatMap((segment) => {
      if (segment.kind !== "tool_use" || completedToolCallIds.has(segment.toolCallId)) {
        return [];
      }

      return [
        {
          content,
          messageId: message.id,
          toolCallId: segment.toolCallId,
          type: EventType.TOOL_CALL_RESULT,
        },
        {
          toolCallId: segment.toolCallId,
          type: EventType.TOOL_CALL_END,
        },
      ];
    });
  });
}

export async function projectRuntimeDriverEvents(
  bindings: ApiBindings,
  input: {
    assertCurrentConnection?: () => void;
    currentLiveState?: SessionLiveState | null;
    events: readonly DriverEventEnvelope[];
    driverInstanceId: DriverInstanceId;
    link?: RuntimeSessionLink | null;
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

  const currentLiveState =
    input.currentLiveState ??
    (await loadStoredRuntimeLiveState(database, {
      driverInstanceId: input.driverInstanceId,
      link,
    }));

  let nextLiveState = currentLiveState;
  let liveStateChanged = false;
  let finalAssistantMessage: ProjectRuntimeDriverEventsResult["finalAssistantMessage"] = null;
  let sessionTitle: string | null = null;
  let usage: ProjectRuntimeDriverEventsResult["usage"] = null;
  const runtimeEvents: ProjectedRuntimeEventRecord[] = [];
  const sessionDeliveryEvents: ProjectRuntimeDriverEventsResult["sessionDeliveryEvents"] = [];
  const transitions: RuntimeDriverRunTransition[] = [];

  function appendCanonicalEvent(source: DriverEventEnvelope, event: RuntimeEventEnvelope): void {
    runtimeEvents.push({
      event,
      occurredAt: toDriverEventOccurredAtMs(source.occurredAt),
      sourceEventId: resolveDriverEventPersistenceSourceId(source, event),
    });
  }

  function appendSessionDeliveryEvent(
    source: DriverEventEnvelope,
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
    let event = parseRuntimeEventEnvelope(envelope.event);
    assertRuntimeEventMatchesDriverLink(event, {
      driverInstanceId: input.driverInstanceId,
      link,
    });
    assertRuntimeEventMatchesDriverEnvelope(event, {
      eventId: envelope.eventId,
    });
    if (
      link.sessionRunId !== null &&
      (event.kind === "run.completed" || event.kind === "run.failed")
    ) {
      const budgetFailure = await getSessionRunBudgetFailure(database, link.sessionRunId);
      if (budgetFailure !== null) {
        await recordRuntimeSessionOutputDirectory({
          bindings,
          driverInstanceId: input.driverInstanceId,
          link,
        });
        event = createRuntimeEvent({
          ...event,
          kind: "run.failed",
          payload: { error: budgetFailure },
        });
      }
    }
    appendCanonicalEvent(envelope, event);

    if (event.kind === "runtime.resume.updated") {
      const nativeResumeRef = readNativeResumeRef(event);

      if (nativeResumeRef === null) {
        continue;
      }

      const policy = link.sandboxKind === null ? null : getRuntimeKindPolicy(link.sandboxKind);

      if (policy?.nativeResume.persistence !== "platform") {
        logInfo("runtime.native_resume_ref.ignored", {
          driverInstanceId: input.driverInstanceId,
          kind: nativeResumeRef.kind,
          runtimeId: nativeResumeRef.runtimeId,
          sandboxKind: link.sandboxKind,
          sandboxSubjectKind: link.sandboxSubjectKind,
          sessionId: link.sessionId,
          sessionRunId: link.sessionRunId,
        });
        continue;
      }

      if (link.sessionRunId === null) {
        logInfo("runtime.native_resume_ref.deferred", {
          driverInstanceId: input.driverInstanceId,
          kind: nativeResumeRef.kind,
          runtimeId: nativeResumeRef.runtimeId,
          sessionId: link.sessionId,
        });
        continue;
      }

      input.assertCurrentConnection?.();
      await upsertNativeResumeRef(database, {
        driverInstanceId: input.driverInstanceId,
        nativeResumeRef,
        sessionId: link.sessionId,
        sessionRunId: link.sessionRunId,
      });
      logInfo("runtime.native_resume_ref.observed", {
        driverInstanceId: input.driverInstanceId,
        kind: nativeResumeRef.kind,
        runtimeId: nativeResumeRef.runtimeId,
        sessionId: link.sessionId,
        sessionRunId: link.sessionRunId,
      });
      continue;
    }

    if (event.kind === "file.change.updated" || event.kind === "file.changed") {
      await recordRuntimeFileChanges({
        bindings,
        event,
        link,
      });
      continue;
    }

    if (event.kind === "run.completed") {
      const payload = readRuntimeEventPayload(event);
      const finalMessageId = readRuntimeEventString(payload, "finalMessageId");
      const finalMessageText = readRuntimeEventString(payload, "finalMessageText");
      finalAssistantMessage =
        finalMessageId === null || finalMessageText === null
          ? null
          : { id: finalMessageId, text: finalMessageText };
      await recordRuntimeSessionOutputDirectory({
        bindings,
        driverInstanceId: input.driverInstanceId,
        link,
      });
    }

    if (event.kind === "permission.requested") {
      const request = readRuntimeEventPermissionRequest(event);

      if (request) {
        const permissionsUpdatedEvent = createServerCustomEvent(
          MOSOO_CUSTOM_EVENT.sessionPermissionsUpdated.name,
          {
            permissionRequests: upsertPermissionRequest(nextLiveState.permissionRequests, request),
          },
        );

        nextLiveState = applyAgUiEventToSessionLiveState(nextLiveState, permissionsUpdatedEvent);
        appendSessionDeliveryEvent(envelope, event, permissionsUpdatedEvent);
        liveStateChanged = true;
      }

      continue;
    }

    if (event.kind === "permission.resolved") {
      const payload = readRuntimeEventPayload(event);
      const requestId = readRuntimeEventString(payload, "requestId");
      const permissionRequests =
        readPermissionRequestViews(payload["permissionRequests"]) ??
        (requestId === null
          ? null
          : removePermissionRequest(nextLiveState.permissionRequests, requestId));

      if (permissionRequests !== null) {
        const permissionsUpdatedEvent = createServerCustomEvent(
          MOSOO_CUSTOM_EVENT.sessionPermissionsUpdated.name,
          {
            permissionRequests,
          },
        );

        nextLiveState = applyAgUiEventToSessionLiveState(nextLiveState, permissionsUpdatedEvent);
        appendSessionDeliveryEvent(envelope, event, permissionsUpdatedEvent);
        liveStateChanged = true;
      }

      continue;
    }

    const liveEvents = [
      ...createPendingToolResultEvents(nextLiveState, event),
      ...projectRuntimeEventToSessionDeliveryEvents(event),
    ];

    const setSessionTitle = (title: string | null): void => {
      sessionTitle = title;
    };
    const setUsage = (nextUsage: ProjectRuntimeDriverEventsResult["usage"]): void => {
      usage = nextUsage;
    };

    appendRuntimeDriverCanonicalSideEffects(event, {
      setSessionTitle,
      setUsage,
      transitions,
    });

    for (const liveEvent of liveEvents) {
      nextLiveState = applyAgUiEventToSessionLiveState(nextLiveState, liveEvent);
      appendSessionDeliveryEvent(envelope, event, liveEvent);
      liveStateChanged = true;
    }
  }

  return {
    finalAssistantMessage,
    link,
    liveStateChanged,
    nextLiveState,
    runtimeEvents,
    sessionTitle,
    sessionDeliveryEvents,
    transitions,
    usage,
  };
}

// Driver Contract v2 carries envelope occurredAt as an ISO 8601 string;
// persistence keeps epoch milliseconds. Unparsable or absent values stay null.
function toDriverEventOccurredAtMs(occurredAt: DriverEventEnvelope["occurredAt"]): number | null {
  if (typeof occurredAt !== "string") {
    return null;
  }

  const parsed = Date.parse(occurredAt);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveDriverEventPersistenceSourceId(
  source: DriverEventEnvelope,
  event: RuntimeEventEnvelope,
): string | null {
  if (event.kind === "run.failed" && event.runId !== undefined) {
    return createSessionRunTerminalFailureSourceId(event.runId);
  }

  return source.eventId.trim().length > 0 ? source.eventId : null;
}

function appendRuntimeDriverCanonicalSideEffects(
  event: RuntimeEventEnvelope,
  output: {
    setSessionTitle: (title: string | null) => void;
    setUsage: (usage: ProjectRuntimeDriverEventsResult["usage"]) => void;
    transitions: RuntimeDriverRunTransition[];
  },
): void {
  if (event.kind === "session.info.updated") {
    output.setSessionTitle(
      normalizeRuntimeSessionInfoTitle(
        readRuntimeEventString(readRuntimeEventPayload(event), "title"),
      ),
    );
    return;
  }

  if (event.kind === "usage.updated") {
    output.setUsage(parseNullableSessionUsageSummary(event.payload));
    return;
  }

  const transition = readRuntimeDriverRunTransition(event);

  if (transition !== null) {
    output.transitions.push(transition);
  }
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
