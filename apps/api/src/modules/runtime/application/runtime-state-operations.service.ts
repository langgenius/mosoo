import type {
  SessionRuntimeOperationInput,
  SessionRuntimeOperationName,
  SessionRuntimeOperationResult,
} from "@mosoo/contracts/session";
import type { SessionId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { API_ERROR_CODE, createApiError } from "../../../platform/errors";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureProjectOwnership } from "../../projects/application/project.service";
import { assertPreviewAvailable } from "../../sessions/infrastructure/preview-retention.repository";
import { createSandboxExecutionPlaneAdapter } from "../infrastructure/execution-plane/sandbox-execution-plane-adapter";
import { isSessionTerminalCheckpointReadyForNextRun } from "../infrastructure/session-runs/session-run-admission.repository";
import { executeRuntimeStateOperationSubjects } from "./runtime-state-operation-execution";
import {
  completeRuntimeStateOperationPhase,
  failRuntimeStateOperationPhase,
  listRuntimeStateOperationPhaseTargets,
  startRuntimeStateOperationPhase,
} from "./runtime-state-operation-phases";
import { resolveSessionRuntimeOperationScope } from "./runtime-state-operation-subjects";
import { appendRuntimeDriverRestartAttemptedEvents } from "./runtime-state-operation-target-events";

const executionPlane = createSandboxExecutionPlaneAdapter();

async function assertSessionCheckpointReady(database: D1Database, sessionId: SessionId) {
  if (!(await isSessionTerminalCheckpointReadyForNextRun(database, sessionId))) {
    throw createApiError(
      API_ERROR_CODE.sessionRunCheckpointPending,
      "Session maintenance must wait for its successful turn checkpoint and history.",
    );
  }
}

async function executeSessionRuntimeOperation(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: SessionRuntimeOperationInput,
  operation: SessionRuntimeOperationName,
): Promise<SessionRuntimeOperationResult> {
  const project = await ensureProjectOwnership(bindings.DB, viewer.id, input.projectId);
  const target = { ...input, executionOwnerUserId: project.ownerAccountId };
  const scope = await resolveSessionRuntimeOperationScope(bindings.DB, target);
  await assertPreviewAvailable(bindings.DB, input.sessionId, Date.now());
  await assertSessionCheckpointReady(bindings.DB, input.sessionId);
  if (scope.targets.length === 0) {
    return { affectedSessionCount: 0, ok: true, operation, sessionId: input.sessionId };
  }

  const agentId = scope.targets[0]!.agentId;
  const phase = await startRuntimeStateOperationPhase(bindings, {
    agentId,
    operation,
    targetVersion: null,
    targets: scope.targets,
  });
  const admittedTargets = listRuntimeStateOperationPhaseTargets(phase);
  try {
    if (admittedTargets.length !== 1) {
      throw createApiError(
        API_ERROR_CODE.sessionRuntimeOperationUnavailable,
        "Session changed before maintenance could be admitted.",
      );
    }
    const current = await resolveSessionRuntimeOperationScope(bindings.DB, {
      ...target,
      expectedOperationId: phase.operationId,
    });
    if (scope.subjects[0]?.runtimeSubjectId !== current.subjects[0]?.runtimeSubjectId) {
      throw createApiError(
        API_ERROR_CODE.sessionRuntimeOperationUnavailable,
        "Session execution binding changed before maintenance.",
      );
    }
    await assertSessionCheckpointReady(bindings.DB, input.sessionId);
    if (operation === "restartDriver") {
      await appendRuntimeDriverRestartAttemptedEvents(bindings, {
        targets: admittedTargets,
        targetVersion: null,
      });
    }
    await executeRuntimeStateOperationSubjects(bindings, {
      executionPlane,
      operation,
      operationId: phase.operationId,
      subjects: current.subjects.map((subject) => ({
        runtimeSubjectId: subject.runtimeSubjectId,
        targets: admittedTargets,
      })),
    });
  } catch (error) {
    await failRuntimeStateOperationPhase(bindings, { agentId, operation, phase });
    throw error;
  }
  await completeRuntimeStateOperationPhase(bindings, { agentId, operation, phase });
  return { affectedSessionCount: 1, ok: true, operation, sessionId: input.sessionId };
}

export function restartSessionDriver(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: SessionRuntimeOperationInput,
) {
  return executeSessionRuntimeOperation(bindings, viewer, input, "restartDriver");
}

export function recreateSessionSandbox(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: SessionRuntimeOperationInput,
) {
  return executeSessionRuntimeOperation(bindings, viewer, input, "recreateSandbox");
}
