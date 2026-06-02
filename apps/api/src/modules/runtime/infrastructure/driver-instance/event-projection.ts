import { readRuntimeRunPayload } from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";

import { createInitialSessionLiveState } from "../../../sessions/application/session-live-state.service";
import type {
  SessionLiveState,
  SessionPermissionRequestView,
} from "../../../sessions/application/session-live-state.service";
import { normalizeSessionTitle } from "../../../sessions/domain/session-title";
import type { RuntimeDriverRunTransition, RuntimeSessionLink } from "./event-types";

export function compactRuntimeDriverRunTransitions(
  transitions: RuntimeDriverRunTransition[],
): RuntimeDriverRunTransition[] {
  let sawRunning = false;
  let terminalTransition: RuntimeDriverRunTransition | null = null;

  for (const transition of transitions) {
    if (transition.status === "running") {
      if (!terminalTransition) {
        sawRunning = true;
      }

      continue;
    }

    terminalTransition = transition;
  }

  if (terminalTransition) {
    return [terminalTransition];
  }

  return sawRunning
    ? [
        {
          status: "running",
        },
      ]
    : [];
}

export function readRuntimeDriverRunTransition(
  event: RuntimeEventEnvelope,
): RuntimeDriverRunTransition | null {
  if (event.kind === "run.started") {
    readRuntimeRunPayload(event);
    return {
      status: "running",
    };
  }

  if (event.kind === "run.completed") {
    readRuntimeRunPayload(event);
    return {
      status: "completed",
    };
  }

  if (event.kind === "run.cancelled") {
    return {
      status: "cancelled",
    };
  }

  if (event.kind !== "run.failed") {
    return null;
  }

  const run = readRuntimeRunPayload(event).run;
  const error = run?.error;

  if (error === null || error === undefined) {
    throw new Error("Runtime event run.failed payload must include an error.");
  }

  return {
    error,
    status: "failed",
  };
}

export function createBaseLiveState(
  input: Pick<RuntimeSessionLink, "callerId" | "creatorId" | "sessionId"> & {
    driverInstanceId: string;
  },
): SessionLiveState {
  return createInitialSessionLiveState({
    sessionId: input.sessionId ?? input.driverInstanceId,
    title: null,
    viewerId: input.callerId ?? input.creatorId ?? input.driverInstanceId,
  });
}

export function normalizeRuntimeSessionInfoTitle(title: string | null | undefined): string | null {
  if (typeof title !== "string" || title.trim().length === 0) {
    return null;
  }

  return normalizeSessionTitle(title);
}

export function upsertPermissionRequest(
  current: SessionPermissionRequestView[],
  next: SessionPermissionRequestView,
): SessionPermissionRequestView[] {
  const requests = current.filter((request) => request.requestId !== next.requestId);
  requests.push(next);
  return requests;
}

export function removePermissionRequest(
  current: SessionPermissionRequestView[],
  requestId: string,
): SessionPermissionRequestView[] {
  return current.filter((request) => request.requestId !== requestId);
}

export function readPermissionRequestViews(value: unknown): SessionPermissionRequestView[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const requests: SessionPermissionRequestView[] = [];

  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }

    const requestId = readString(entry["requestId"]);
    const runId = readString(entry["runId"]);
    const title = readString(entry["title"]);
    const driverInstanceId = readString(entry["driverInstanceId"]);

    if (requestId === null || runId === null || title === null || driverInstanceId === null) {
      continue;
    }

    requests.push({
      driverInstanceId,
      rawInput: readNullableString(entry["rawInput"]),
      requestId,
      runId,
      title,
      toolCallId: readNullableString(entry["toolCallId"]),
      toolKind: readNullableString(entry["toolKind"]),
    });
  }

  return requests;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
