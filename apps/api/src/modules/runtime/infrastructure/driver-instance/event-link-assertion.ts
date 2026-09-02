import { readRuntimeAgentTaskSnapshot } from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope, RuntimeEventKind } from "@mosoo/runtime-events";

import { ACTIVE_SESSION_RUN_STATUSES } from "../../domain/session-run-lifecycle.machine";
import type { RuntimeSessionLink } from "./event-types";

const activeSessionRunStatuses = new Set<string>(ACTIVE_SESSION_RUN_STATUSES);

const runBoundRuntimeEventDomains = new Set<string>([
  "image",
  "item",
  "message",
  "review",
  "shell",
  "thought",
  "tool",
  "user",
  "web",
]);

const runBoundRuntimeEventKinds = new Set<RuntimeEventKind>([
  "agent.tasks.replaced",
  "file.change.updated",
  "mcp.tool.updated",
  "permission.requested",
  "permission.resolved",
  "permission.review.completed",
  "permission.review.started",
  "runtime.resume.updated",
  "usage.updated",
]);

function runtimeEventRequiresRunLink(kind: RuntimeEventKind): boolean {
  if (kind.startsWith("run.")) {
    return true;
  }

  return (
    runBoundRuntimeEventDomains.has(kind.split(".")[0] ?? "") || runBoundRuntimeEventKinds.has(kind)
  );
}

export function assertRuntimeEventMatchesDriverLink(
  event: RuntimeEventEnvelope,
  input: {
    driverInstanceId: string;
    link: RuntimeSessionLink;
  },
): void {
  if (event.sessionId !== input.link.sessionId) {
    throw new Error("Runtime driver event session id does not match the driver session link.");
  }

  if (event.driverInstanceId !== input.driverInstanceId) {
    throw new Error("Runtime driver event driver instance id does not match the request.");
  }

  if ((event.runtimeId ?? null) !== input.link.runtimeId) {
    throw new Error("Runtime driver event runtime id does not match the driver session link.");
  }

  if (event.runId !== undefined && (event.traceId ?? null) !== input.link.traceId) {
    throw new Error("Runtime driver event trace id does not match the driver session link.");
  }

  if (event.runId === undefined && !runtimeEventRequiresRunLink(event.kind)) {
    return;
  }

  if (event.runId !== input.link.sessionRunId) {
    throw new Error("Runtime driver event run id does not match the driver session link.");
  }

  if (
    event.kind === "agent.tasks.replaced" &&
    !activeSessionRunStatuses.has(input.link.sessionRunStatus ?? "") &&
    readRuntimeAgentTaskSnapshot(event).tasks.length > 0
  ) {
    throw new Error("Runtime agent task snapshot requires an active session run.");
  }
}
