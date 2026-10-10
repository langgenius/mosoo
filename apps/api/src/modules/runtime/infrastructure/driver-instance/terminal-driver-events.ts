import type { DriverFailureInput } from "@mosoo/agent-driver/orpc";
import type { DriverInstanceId, SessionId, SessionRunId } from "@mosoo/id";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { recordCanonicalSessionRunFailure } from "../../application/session-runs/session-run-terminal-failure.service";
import { isTerminalSessionRunStatus } from "../../domain/session-run-lifecycle.machine";
import { getSessionRunCompletionProof } from "../session-runs/session-run-completion-proof";
import type { RuntimeSessionLink } from "./event-types";
import { recordRuntimeSessionOutputDirectory } from "./runtime-session-output-store";
import { getRuntimeSessionLink } from "./session-link.repository";
import { terminalConflict } from "./terminal-conflict";
import { releaseTerminalDriverInstanceSessionRun } from "./terminal-run-release";

interface TerminalDriverRunInput {
  driverInstanceId: DriverInstanceId;
  runId: SessionRunId;
}

type LinkedDriverRun = RuntimeSessionLink & { sessionId: SessionId; sessionRunId: SessionRunId };

async function requireLinkedDriverRun(
  database: D1Database,
  input: TerminalDriverRunInput,
): Promise<LinkedDriverRun> {
  const link = await getRuntimeSessionLink(database, input.driverInstanceId, {
    sessionRunId: input.runId,
  });
  if (link.sessionId === null || link.sessionRunId !== input.runId) {
    throw terminalConflict({
      currentStatus: link.sessionRunStatus,
      runId: input.runId,
      reason: "Terminal RPC run does not belong to this Driver instance.",
    });
  }
  return { ...link, sessionId: link.sessionId, sessionRunId: input.runId };
}

export async function recordDriverInstanceCompletion(
  bindings: ApiBindings,
  input: TerminalDriverRunInput,
): Promise<LinkedDriverRun> {
  const database = bindings.DB;
  const link = await requireLinkedDriverRun(database, input);
  if (link.sessionRunStatus !== "completed") {
    throw terminalConflict({
      currentStatus: link.sessionRunStatus,
      runId: input.runId,
      reason: "Completion RPC requires a committed run.completed event.",
    });
  }

  const proof = await getSessionRunCompletionProof(database, {
    sessionId: link.sessionId,
    runId: input.runId,
  });
  if (proof === null || proof.event.driverInstanceId !== input.driverInstanceId) {
    throw terminalConflict({
      currentStatus: link.sessionRunStatus,
      runId: input.runId,
      sourceEventId: proof?.sourceEventId ?? null,
      reason:
        "Completion RPC requires a matching canonical receipt, native checkpoint and ready backup.",
    });
  }

  await releaseTerminalDriverInstanceSessionRun(bindings, {
    driverInstanceId: input.driverInstanceId,
    sessionRunId: input.runId,
  });
  return link;
}

export async function recordDriverInstanceFailure(
  bindings: ApiBindings,
  input: TerminalDriverRunInput & { error: DriverFailureInput["error"] },
): Promise<LinkedDriverRun> {
  const link = await requireLinkedDriverRun(bindings.DB, input);
  if (isTerminalSessionRunStatus(link.sessionRunStatus) && link.sessionRunStatus !== "failed") {
    throw terminalConflict({
      currentStatus: link.sessionRunStatus,
      runId: input.runId,
      reason: "Failure RPC conflicts with the Run's persisted terminal outcome.",
    });
  }

  await recordRuntimeSessionOutputDirectory({
    bindings,
    driverInstanceId: input.driverInstanceId,
    link,
  });
  const outcome = await recordCanonicalSessionRunFailure(bindings, {
    error: input.error,
    runId: input.runId,
    sessionId: link.sessionId,
    source: "driver",
  });
  if (outcome.kind !== "failed") {
    throw terminalConflict({
      currentStatus:
        "currentStatus" in outcome.transition
          ? outcome.transition.currentStatus
          : link.sessionRunStatus,
      runId: input.runId,
      reason: "Failure RPC lost a concurrent Run transition.",
    });
  }

  await releaseTerminalDriverInstanceSessionRun(bindings, {
    driverInstanceId: input.driverInstanceId,
    sessionRunId: input.runId,
  });
  return { ...link, sessionRunStatus: "failed" };
}
