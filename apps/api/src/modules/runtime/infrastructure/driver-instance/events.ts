import {
  MOSOO_CUSTOM_EVENT,
  createServerCustomEvent,
  parseNullableSessionUsageSummary,
} from "@mosoo/ag-ui-session";
import type { DriverInstanceId } from "@mosoo/id";
import {
  parseRuntimeEventEnvelope,
  readRuntimeEventFileChanges,
  readRuntimeEventPayload,
  readRuntimeEventPermissionRequest,
  readRuntimeEventString,
} from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";
import type { DriverEventEnvelope } from "agent-driver/events";

import { logInfo } from "../../../../platform/cloudflare/logger";
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
import { upsertNativeResumeRef } from "../native-resume-ref.repository";
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
import { indexRuntimeSpaceFileMutation } from "./organization-access";
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

export async function projectRuntimeDriverEvents(
  database: D1Database,
  input: {
    assertCurrentConnection?: () => void;
    currentLiveState?: SessionLiveState | null;
    events: readonly DriverEventEnvelope[];
    driverInstanceId: DriverInstanceId;
    link?: RuntimeSessionLink | null;
  },
): Promise<ProjectRuntimeDriverEventsResult> {
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
  let sessionTitle: string | null = null;
  let usage: ProjectRuntimeDriverEventsResult["usage"] = null;
  const runtimeEvents: ProjectedRuntimeEventRecord[] = [];
  const sessionDeliveryEvents: ProjectRuntimeDriverEventsResult["sessionDeliveryEvents"] = [];
  const transitions: RuntimeDriverRunTransition[] = [];

  function appendCanonicalEvent(source: DriverEventEnvelope, event: RuntimeEventEnvelope): void {
    runtimeEvents.push({
      event,
      occurredAt:
        typeof source.occurredAt === "number" && Number.isFinite(source.occurredAt)
          ? source.occurredAt
          : null,
      sourceEventId: source.eventId.trim().length > 0 ? source.eventId : null,
    });
  }

  function appendSessionDeliveryEvent(
    source: DriverEventEnvelope,
    deliveryEvent: SessionDeliveryEvent,
  ): void {
    sessionDeliveryEvents.push({
      event: deliveryEvent,
      occurredAt:
        typeof source.occurredAt === "number" && Number.isFinite(source.occurredAt)
          ? source.occurredAt
          : null,
      sourceEventId: source.eventId.trim().length > 0 ? source.eventId : null,
    });
  }

  for (const envelope of input.events) {
    input.assertCurrentConnection?.();
    const event = parseRuntimeEventEnvelope(envelope.event);
    assertRuntimeEventMatchesDriverLink(event, {
      driverInstanceId: input.driverInstanceId,
      link,
    });
    assertRuntimeEventMatchesDriverEnvelope(event, {
      eventId: envelope.eventId,
    });
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
      const fileChanges = readRuntimeEventFileChanges(event);

      for (const fileChange of fileChanges) {
        input.assertCurrentConnection?.();
        const artifactChange = await indexRuntimeSpaceFileMutation(
          database,
          {
            executionOwnerUserId: link.executionOwnerId,
            sessionId: link.sessionId,
          },
          fileChange,
        );
        input.assertCurrentConnection?.();
        if (!artifactChange) {
          continue;
        }

        const filesUpdatedEvent = createServerCustomEvent(
          MOSOO_CUSTOM_EVENT.sessionFilesUpdated.name,
          {
            change: artifactChange,
          },
        );

        nextLiveState = applyAgUiEventToSessionLiveState(nextLiveState, filesUpdatedEvent);
        appendSessionDeliveryEvent(envelope, filesUpdatedEvent);
        liveStateChanged = true;
      }

      continue;
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
        appendSessionDeliveryEvent(envelope, permissionsUpdatedEvent);
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
        appendSessionDeliveryEvent(envelope, permissionsUpdatedEvent);
        liveStateChanged = true;
      }

      continue;
    }

    const liveEvents = projectRuntimeEventToSessionDeliveryEvents(event);

    const setSessionTitle = (title: string | null): void => {
      sessionTitle = title;
    };
    const setUsage = (nextUsage: ProjectRuntimeDriverEventsResult["usage"]): void => {
      usage = nextUsage;
    };

    appendRuntimeDriverCanonicalSideEffects(event, { setSessionTitle, setUsage, transitions });

    for (const liveEvent of liveEvents) {
      nextLiveState = applyAgUiEventToSessionLiveState(nextLiveState, liveEvent);
      appendSessionDeliveryEvent(envelope, liveEvent);
      liveStateChanged = true;
    }
  }

  return {
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
