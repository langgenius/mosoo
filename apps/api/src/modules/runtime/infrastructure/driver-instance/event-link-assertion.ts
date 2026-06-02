import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";
import type { RuntimeEventKind } from "@mosoo/runtime-events";

import type { RuntimeSessionLink } from "./event-types";

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
  "file.change.updated",
  "mcp.tool.updated",
  "permission.requested",
  "permission.resolved",
  "permission.review.completed",
  "permission.review.started",
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

  if (event.runId === undefined && !runtimeEventRequiresRunLink(event.kind)) {
    return;
  }

  if (event.runId !== input.link.sessionRunId) {
    throw new Error("Runtime driver event run id does not match the driver session link.");
  }
}

export function assertRuntimeEventMatchesDriverEnvelope(
  event: RuntimeEventEnvelope,
  input: {
    eventId: string;
  },
): void {
  if (event.sourceEventId !== undefined && event.sourceEventId !== input.eventId) {
    throw new Error("Runtime driver event source id does not match the driver envelope.");
  }
}
