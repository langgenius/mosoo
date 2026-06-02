import type { MosooCustomEvent, MosooSessionFileChange } from "./ag-ui-session-events";
import { MOSOO_CUSTOM_EVENT as CUSTOM_EVENT_REGISTRY } from "./custom-event-registry";
import type { SessionLiveState } from "./live-state";
import { updateSessionMetadataState } from "./live-state-custom-metadata.reducer";
import { completePendingToolUses, normalizeMessagePlan } from "./live-state-message.reducer";
import {
  currentIsoTimestamp,
  isTerminalRunStatus,
  touchSessionLiveState,
} from "./live-state.reducer-core";

type CustomEventByName<TName extends MosooCustomEvent["name"]> = Extract<
  MosooCustomEvent,
  { name: TName }
>;

function applyFileChange(
  files: SessionLiveState["files"],
  change: MosooSessionFileChange,
): SessionLiveState["files"] {
  if (change.change === "delete") {
    return files.filter((file) => file.id !== change.fileId);
  }

  return [change.file, ...files.filter((file) => file.id !== change.file.id)];
}

function resolveFilesUpdate(
  state: SessionLiveState,
  event: CustomEventByName<typeof CUSTOM_EVENT_REGISTRY.sessionFilesUpdated.name>,
): SessionLiveState["files"] {
  if (event.value.files !== undefined) {
    return event.value.files;
  }

  if (event.value.change !== undefined) {
    return applyFileChange(state.files, event.value.change);
  }

  return state.files;
}

function resolveRunAfterPermissionUpdate(
  state: SessionLiveState,
  permissionRequests: SessionLiveState["permissionRequests"],
): SessionLiveState["run"] {
  if (
    permissionRequests.length > 0 &&
    state.run.id !== null &&
    !isTerminalRunStatus(state.run.status)
  ) {
    return {
      ...state.run,
      status: "waiting_input",
    };
  }

  if (state.run.status === "waiting_input") {
    return {
      ...state.run,
      status: "running",
    };
  }

  return state.run;
}

function isPermissionRequestForCurrentRun(
  state: SessionLiveState,
  request: SessionLiveState["permissionRequests"][number],
): boolean {
  return state.run.id === request.runId && !isTerminalRunStatus(state.run.status);
}

function filterPermissionRequestsForCurrentRun(
  state: SessionLiveState,
  permissionRequests: SessionLiveState["permissionRequests"],
): SessionLiveState["permissionRequests"] {
  return permissionRequests.filter((request) => isPermissionRequestForCurrentRun(state, request));
}

function updatePermissionRequests(
  state: SessionLiveState,
  event: CustomEventByName<typeof CUSTOM_EVENT_REGISTRY.sessionPermissionsUpdated.name>,
): SessionLiveState {
  const permissionRequests = isTerminalRunStatus(state.run.status)
    ? []
    : filterPermissionRequestsForCurrentRun(state, event.value.permissionRequests);

  return touchSessionLiveState({
    ...state,
    permissionRequests,
    run: resolveRunAfterPermissionUpdate(state, permissionRequests),
  });
}

function shouldApplySessionRunUpdate(
  state: SessionLiveState,
  nextRun: SessionLiveState["run"],
): boolean {
  if (nextRun.id === null) {
    return state.run.id === null && !isTerminalRunStatus(nextRun.status);
  }

  if (state.run.id === null) {
    return !isTerminalRunStatus(nextRun.status);
  }

  if (state.run.id !== nextRun.id) {
    return isTerminalRunStatus(state.run.status) && !isTerminalRunStatus(nextRun.status);
  }

  return !isTerminalRunStatus(state.run.status) || isTerminalRunStatus(nextRun.status);
}

function mergeSessionRunUpdate(
  currentRun: SessionLiveState["run"],
  nextRun: SessionLiveState["run"],
): SessionLiveState["run"] {
  if (currentRun.id === null || currentRun.id !== nextRun.id) {
    return nextRun;
  }

  return {
    ...nextRun,
    completedAt: nextRun.completedAt ?? currentRun.completedAt,
    startedAt: nextRun.startedAt ?? currentRun.startedAt,
    traceId: nextRun.traceId ?? currentRun.traceId,
  };
}

function updateInfraForRun(
  state: SessionLiveState,
  run: SessionLiveState["run"],
): SessionLiveState["infra"] {
  if (run.status === "failed" && run.error !== null) {
    return {
      ...state.infra,
      lastFailureMessage: run.error.message,
      lastFailureReason: run.error.code,
      reconnecting: false,
    };
  }

  if (run.status === "idle") {
    return state.infra;
  }

  return {
    ...state.infra,
    lastFailureMessage: null,
    lastFailureReason: null,
    reconnecting: false,
  };
}

function updateRunState(
  state: SessionLiveState,
  event: CustomEventByName<typeof CUSTOM_EVENT_REGISTRY.sessionRunUpdated.name>,
): SessionLiveState {
  if (!shouldApplySessionRunUpdate(state, event.value.run)) {
    return state;
  }

  const run = mergeSessionRunUpdate(state.run, event.value.run);

  return touchSessionLiveState({
    ...state,
    infra: updateInfraForRun(state, run),
    lifecycle: event.value.lifecycle,
    permissionRequests: isTerminalRunStatus(run.status) ? [] : state.permissionRequests,
    run,
  });
}

function updateInfraForRescheduling(
  state: SessionLiveState,
  event: CustomEventByName<typeof CUSTOM_EVENT_REGISTRY.sessionInfraRescheduling.name>,
): SessionLiveState {
  return touchSessionLiveState({
    ...state,
    infra: {
      ...state.infra,
      lastFailureMessage: null,
      lastFailureReason: event.value.reason ?? state.infra.lastFailureReason,
      lastSeen: event.value.lastSeen,
      reconnecting: true,
    },
    lifecycle: "RESCHEDULING",
  });
}

function updateInfraForAgentChange(
  state: SessionLiveState,
  event: CustomEventByName<typeof CUSTOM_EVENT_REGISTRY.agentUpdating.name>,
): SessionLiveState {
  return touchSessionLiveState({
    ...state,
    infra: {
      ...state.infra,
      lastFailureMessage: null,
      lastFailureReason: `agent.${event.value.operation}`,
      lastSeen: currentIsoTimestamp(),
      reconnecting: true,
    },
    lifecycle: "RESCHEDULING",
  });
}

function updateInfraForRunning(
  state: SessionLiveState,
  event: CustomEventByName<typeof CUSTOM_EVENT_REGISTRY.sessionInfraRunning.name>,
): SessionLiveState {
  return touchSessionLiveState({
    ...state,
    infra: {
      ...state.infra,
      lastFailureMessage: null,
      lastFailureReason: null,
      lastSeen: event.value.resumedAt,
      reconnecting: false,
    },
    lifecycle: "RUNNING",
  });
}

function updateInfraForReady(
  state: SessionLiveState,
  event: CustomEventByName<typeof CUSTOM_EVENT_REGISTRY.agentReady.name>,
): SessionLiveState {
  return touchSessionLiveState({
    ...state,
    infra: {
      ...state.infra,
      lastFailureMessage: null,
      lastFailureReason: null,
      lastSeen: event.value.readyAt,
      reconnecting: false,
    },
    lifecycle: "IDLE",
  });
}

function stopSession(
  state: SessionLiveState,
  event: CustomEventByName<typeof CUSTOM_EVENT_REGISTRY.sessionStopped.name>,
): SessionLiveState {
  const terminalState = completePendingToolUses(state);
  const message = event.value.message ?? null;
  const lastSeen = "lastSeen" in event.value ? event.value.lastSeen : terminalState.infra.lastSeen;

  return touchSessionLiveState({
    ...terminalState,
    infra: {
      ...terminalState.infra,
      lastFailureMessage: message,
      lastFailureReason: event.value.reason,
      lastSeen,
      reconnecting: false,
    },
    lifecycle: "TERMINATED",
    permissionRequests: [],
    run: {
      ...terminalState.run,
      completedAt: terminalState.run.completedAt ?? currentIsoTimestamp(),
      error: terminalState.run.error ?? {
        code: event.value.reason,
        details: {},
        message: message ?? "Session stopped.",
        retryable: false,
      },
      status: terminalState.run.status === "completed" ? terminalState.run.status : "failed",
    },
  });
}

export function updateCustomState(
  state: SessionLiveState,
  event: MosooCustomEvent,
): SessionLiveState {
  return updateRuntimeCustomState(state, event);
}

function updateRuntimeCustomState(
  state: SessionLiveState,
  event: MosooCustomEvent,
): SessionLiveState {
  // This switch intentionally handles the runtime slice of MosooCustomEvent.
  switch (event.name) {
    case CUSTOM_EVENT_REGISTRY.sessionPlanUpdated.name: {
      return touchSessionLiveState({
        ...state,
        plan: normalizeMessagePlan(event.value.plan),
      });
    }

    case CUSTOM_EVENT_REGISTRY.sessionFilesUpdated.name: {
      return touchSessionLiveState({
        ...state,
        files: resolveFilesUpdate(state, event),
      });
    }

    case CUSTOM_EVENT_REGISTRY.sessionPermissionsUpdated.name: {
      return updatePermissionRequests(state, event);
    }

    case CUSTOM_EVENT_REGISTRY.sessionReadiness.name: {
      return touchSessionLiveState({
        ...state,
        readiness: event.value.readiness,
      });
    }

    case CUSTOM_EVENT_REGISTRY.sessionRunUpdated.name: {
      return updateRunState(state, event);
    }

    case CUSTOM_EVENT_REGISTRY.sessionInfraRescheduling.name: {
      return updateInfraForRescheduling(state, event);
    }

    case CUSTOM_EVENT_REGISTRY.agentUpdating.name: {
      return updateInfraForAgentChange(state, event);
    }

    case CUSTOM_EVENT_REGISTRY.sessionInfraRunning.name: {
      return updateInfraForRunning(state, event);
    }

    case CUSTOM_EVENT_REGISTRY.agentReady.name: {
      return updateInfraForReady(state, event);
    }

    case CUSTOM_EVENT_REGISTRY.sessionStopped.name: {
      return stopSession(state, event);
    }
    default: {
      return updateSessionMetadataState(state, event);
    }
  }
}
