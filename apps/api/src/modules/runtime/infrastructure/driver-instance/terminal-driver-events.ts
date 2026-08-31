import type { DriverFailureInput } from "@mosoo/agent-driver/orpc";
import type { RunError, SessionRunSummary } from "@mosoo/contracts/session-run";
import { createPlatformId } from "@mosoo/id";
import type { DriverInstanceId, RuntimeEventId, SessionId, SessionRunId } from "@mosoo/id";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { currentTimestampMs, toIsoString } from "../../../../time";
import { createSessionRunTerminalSourceId } from "../../domain/session-run-terminal-event-id";
import { getSessionRunSummary } from "../session-runs/session-run-store.repository";
import {
  adoptTerminalRunProjection,
  commitTerminalRunProjection,
} from "./completed-run-commit.repository";
import type { DriverTerminalRunStatus } from "./completed-run-commit.repository";
import { createCanonicalDriverRunFailedEvent } from "./driver-event-canonicalization";
import type { RuntimeSessionLink } from "./event-types";
import { getDriverInstanceLifecycleIdentity } from "./lifecycle";
import { getRuntimeSessionLink } from "./session-link.repository";
import { releaseTerminalDriverInstanceSessionRun } from "./terminal-run-release";

function terminalTargetFromRun(
  status: SessionRunSummary["status"],
): DriverTerminalRunStatus | null {
  switch (status) {
    case "cancelled":
      return "cancelled";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "expired":
      return "cancelled";
    case "booting":
    case "queued":
    case "running":
    case "waiting_input":
      return null;
  }
}

async function commitOrAdoptTerminalRun(
  bindings: ApiBindings,
  input: {
    driverConnectionId?: string;
    driverGeneration?: number;
    driverInstanceId: DriverInstanceId;
    error: RunError | null;
    requestedStatus: "completed" | "failed";
    runtimeId: string;
    sessionId: SessionId;
    sessionRunId: SessionRunId;
  },
): Promise<void> {
  const current = await getSessionRunSummary(bindings.DB, input.sessionRunId);
  if (current === null) {
    throw new Error("Terminal Driver Session Run was not found.");
  }

  const currentTarget = terminalTargetFromRun(current.status);
  const targetStatus = currentTarget ?? input.requestedStatus;
  const expectedDriverObservation =
    input.driverConnectionId === undefined || input.driverGeneration === undefined
      ? undefined
      : {
          connectionId: input.driverConnectionId,
          driverInstanceId: input.driverInstanceId,
          generation: input.driverGeneration,
        };
  const adopted = await adoptTerminalRunProjection(bindings.DB, {
    ...(expectedDriverObservation === undefined ? {} : { expectedDriverObservation }),
    expectedTargetStatus: targetStatus,
    runId: input.sessionRunId,
    sessionId: input.sessionId,
  });
  if (adopted.kind !== "missing") {
    if (adopted.kind === "stale") {
      throw new Error(
        `Terminal Driver Session Run lost a concurrent ${adopted.currentStatus} race.`,
      );
    }
    return;
  }

  if (targetStatus !== "failed") {
    throw new Error(
      `${targetStatus === "completed" ? "Completed" : "Cancelled"} Session Run is missing its canonical terminal event.`,
    );
  }

  const runError = currentTarget === "failed" ? current.error : input.error;
  if (runError === null) {
    throw new Error("Failed Session Run is missing its authoritative durable error.");
  }
  const timestampMs = currentTimestampMs();
  const timestamp = toIsoString(timestampMs);
  const sourceEventId = createSessionRunTerminalSourceId(input.sessionRunId, "run.failed");
  const event = createCanonicalDriverRunFailedEvent({
    driverInstanceId: input.driverInstanceId,
    error: runError,
    id: createPlatformId<RuntimeEventId>(),
    occurredAt: timestamp,
    runId: input.sessionRunId,
    runtimeId: input.runtimeId,
    sessionId: input.sessionId,
    traceId: current.traceId,
  });

  const outcome = await commitTerminalRunProjection(bindings.DB, {
    assistantMessage: null,
    error: runError,
    ...(expectedDriverObservation === undefined ? {} : { expectedDriverObservation }),
    runId: input.sessionRunId,
    sessionId: input.sessionId,
    source: "driver",
    targetStatus: "failed",
    terminalEvent: { event, occurredAt: timestampMs, sourceEventId },
    timestampMs,
  });
  if (outcome.kind === "stale") {
    throw new Error(`Terminal Driver Session Run lost a concurrent ${outcome.currentStatus} race.`);
  }
}

function hasLinkedSessionRun(link: RuntimeSessionLink): link is RuntimeSessionLink & {
  runtimeId: string;
  sessionId: SessionId;
  sessionRunId: SessionRunId;
} {
  return link.runtimeId !== null && link.sessionId !== null && link.sessionRunId !== null;
}

async function finishTerminalDriverRun(
  bindings: ApiBindings,
  input: {
    driverConnectionId?: string;
    driverGeneration?: number;
    driverInstanceId: DriverInstanceId;
    error: RunError | null;
    link?: RuntimeSessionLink;
    requestedStatus: "completed" | "failed";
    sessionRunId: SessionRunId;
  },
): Promise<void> {
  if ((input.driverConnectionId === undefined) !== (input.driverGeneration === undefined)) {
    throw new Error("Terminal Driver connection identity must be provided together.");
  }

  const link =
    input.link ??
    (await getRuntimeSessionLink(bindings.DB, input.driverInstanceId, {
      sessionRunId: input.sessionRunId,
    }));

  if (link.sessionRunId !== input.sessionRunId) {
    throw new Error("Terminal Driver Session Run identity does not match the request.");
  }
  if (!hasLinkedSessionRun(link)) {
    throw new Error("Terminal Driver Session Run is missing its durable session identity.");
  }

  const driverGeneration =
    input.driverGeneration ??
    (await getDriverInstanceLifecycleIdentity(bindings, input.driverInstanceId))?.generation;
  if (driverGeneration === undefined) {
    throw new Error("Terminal Driver instance identity was not found.");
  }

  await commitOrAdoptTerminalRun(bindings, {
    ...(input.driverConnectionId === undefined
      ? {}
      : { driverConnectionId: input.driverConnectionId }),
    ...(input.driverGeneration === undefined ? {} : { driverGeneration: input.driverGeneration }),
    driverInstanceId: input.driverInstanceId,
    error: input.error,
    requestedStatus: input.requestedStatus,
    runtimeId: link.runtimeId,
    sessionId: link.sessionId,
    sessionRunId: input.sessionRunId,
  });
  await releaseTerminalDriverInstanceSessionRun(bindings, {
    ...(input.driverConnectionId === undefined
      ? {}
      : { expectedDriverConnectionId: input.driverConnectionId }),
    driverGeneration,
    driverInstanceId: input.driverInstanceId,
    sessionRunId: input.sessionRunId,
  });
}

export async function recordDriverInstanceCompletion(
  bindings: ApiBindings,
  input: {
    driverConnectionId?: string;
    driverGeneration?: number;
    driverInstanceId: DriverInstanceId;
    sessionRunId: SessionRunId;
  },
): Promise<void> {
  await finishTerminalDriverRun(bindings, {
    ...(input.driverConnectionId === undefined
      ? {}
      : { driverConnectionId: input.driverConnectionId }),
    ...(input.driverGeneration === undefined ? {} : { driverGeneration: input.driverGeneration }),
    driverInstanceId: input.driverInstanceId,
    error: null,
    requestedStatus: "completed",
    sessionRunId: input.sessionRunId,
  });
}

export async function recordDriverInstanceFailure(
  bindings: ApiBindings,
  input: {
    driverConnectionId?: string;
    driverGeneration?: number;
    error: DriverFailureInput["error"];
    driverInstanceId: DriverInstanceId;
    link?: RuntimeSessionLink;
    sessionRunId: SessionRunId;
  },
): Promise<void> {
  await finishTerminalDriverRun(bindings, {
    ...(input.driverConnectionId === undefined
      ? {}
      : { driverConnectionId: input.driverConnectionId }),
    ...(input.driverGeneration === undefined ? {} : { driverGeneration: input.driverGeneration }),
    driverInstanceId: input.driverInstanceId,
    error: input.error,
    ...(input.link === undefined ? {} : { link: input.link }),
    requestedStatus: "failed",
    sessionRunId: input.sessionRunId,
  });
}
