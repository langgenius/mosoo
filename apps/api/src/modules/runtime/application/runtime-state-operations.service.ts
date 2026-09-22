import type {
  RuntimeStateOperationInput,
  RuntimeStateOperationName,
  RuntimeStateOperationResult,
} from "@mosoo/contracts/agent";
import type {
  SessionRuntimeOperationInput,
  SessionRuntimeOperationName,
  SessionRuntimeOperationResult,
} from "@mosoo/contracts/session";
import type { AgentId, SessionId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { API_ERROR_CODE, createApiError } from "../../../platform/errors";
import { ensureProjectAgentOwner } from "../../agents/application/agent-access.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureProjectOwnership } from "../../projects/application/project.service";
import type { RuntimeSubjectScope } from "../domain/runtime-kind-policy";
import { getRuntimeKindPolicy } from "../domain/runtime-kind-policy";
import { createSandboxExecutionPlaneAdapter } from "../infrastructure/execution-plane/sandbox-execution-plane-adapter";
import { enforceSandboxBackupConfigured } from "../infrastructure/sandbox-backup-config";
import { isSessionTerminalCheckpointReadyForNextRun } from "../infrastructure/session-runs/session-run-admission.repository";
import { executeRuntimeStateOperationSubjects } from "./runtime-state-operation-execution";
import {
  completeRuntimeStateOperationPhase,
  failRuntimeStateOperationPhase,
  listRuntimeStateOperationPhaseTargets,
  startRuntimeStateOperationPhase,
} from "./runtime-state-operation-phases";
import {
  resolveRuntimeOperationScope,
  resolveSessionRuntimeOperationScope,
  selectAdmittedRuntimeOperationSubjects,
} from "./runtime-state-operation-subjects";
import type {
  RuntimeOperationScope,
  RuntimeOperationSubject,
  SessionRuntimeOperationTarget,
} from "./runtime-state-operation-subjects";
import { appendRuntimeDriverRestartAttemptedEvents } from "./runtime-state-operation-target-events";
import { resolveRuntimeOperationTargetVersion } from "./runtime-state-operation-version";
import type { RuntimeOperationTargetVersion } from "./runtime-state-operation-version";
import { assertSessionRecoveryAvailable } from "./session-runs/session-recovery.service";

const executionPlane = createSandboxExecutionPlaneAdapter();

async function executeRuntimeStateOperation(context: {
  bindings: ApiBindings;
  input: RuntimeStateOperationInput;
  operation: RuntimeStateOperationName;
  viewer: AuthenticatedViewer;
}): Promise<RuntimeStateOperationResult> {
  const { bindings, input, operation, viewer } = context;
  const { agent } = await ensureProjectAgentOwner(bindings.DB, viewer.id, {
    agentId: input.agentId,
    projectId: input.projectId,
  });
  const targetVersion = await resolveRuntimeOperationTargetVersion(bindings.DB, {
    agent,
    ...(input.targetVersion === undefined ? {} : { targetVersion: input.targetVersion }),
  });
  const policy = getRuntimeKindPolicy(agent.kind);
  if (
    (operation === "resetAgentState" && policy.operations.resetSubjectState) ||
    (operation === "recreateSandbox" && policy.checkpoint.createOnRecreate.length > 0)
  ) {
    enforceSandboxBackupConfigured(bindings);
  }
  if (operation === "resetAgentState" && !policy.operations.resetSubjectState) {
    throw new Error("Reset subject state is not available for this runtime kind.");
  }

  const scope = await resolveRuntimeOperationScope(bindings.DB, agent);
  const affectedSessionCount = await executeAdmittedRuntimeOperation(bindings, {
    agentId: agent.id,
    operation,
    scope,
    subjectScope: policy.subject.scope,
    targetVersion,
  });
  return { affectedSessionCount, agentId: agent.id, ok: true, operation };
}

async function assertSessionCheckpointReady(database: D1Database, sessionId: SessionId) {
  if (!(await isSessionTerminalCheckpointReadyForNextRun(database, sessionId))) {
    throw createApiError(
      API_ERROR_CODE.sessionRunCheckpointPending,
      "Session maintenance must wait for its successful turn checkpoint and history.",
    );
  }
}

async function executeAdmittedRuntimeOperation(
  bindings: ApiBindings,
  input: {
    agentId: AgentId | null;
    operation: RuntimeStateOperationName;
    scope: RuntimeOperationScope;
    sessionTarget?: SessionRuntimeOperationTarget;
    subjectScope: RuntimeSubjectScope;
    targetVersion: RuntimeOperationTargetVersion | null;
  },
): Promise<number> {
  const {
    agentId,
    operation,
    targetVersion,
    scope: { subjects, targets },
  } = input;

  const phase = await startRuntimeStateOperationPhase(bindings, {
    agentId,
    operation,
    targetVersion,
    targets,
  });
  const admittedTargets = listRuntimeStateOperationPhaseTargets(phase);
  let admittedSubjects: RuntimeOperationSubject[] = [];

  try {
    admittedSubjects = selectAdmittedRuntimeOperationSubjects({
      admittedTargets,
      scope: input.subjectScope,
      subjects,
      targets,
    });

    if (input.sessionTarget !== undefined) {
      if (admittedTargets.length !== targets.length) {
        throw createApiError(
          API_ERROR_CODE.sessionRuntimeOperationUnavailable,
          "Session changed before maintenance could be admitted.",
        );
      }
      const current = await resolveSessionRuntimeOperationScope(bindings.DB, {
        ...input.sessionTarget,
        expectedOperationId: phase.operationId,
      });
      if (
        current.subjects.length !== admittedSubjects.length ||
        current.subjects.some(
          (subject) =>
            !admittedSubjects.some(
              (admitted) => admitted.runtimeSubjectId === subject.runtimeSubjectId,
            ),
        )
      ) {
        throw createApiError(
          API_ERROR_CODE.sessionRuntimeOperationUnavailable,
          "Session execution binding changed before maintenance.",
        );
      }
      await assertSessionCheckpointReady(bindings.DB, input.sessionTarget.sessionId);
    }

    if (operation === "restartDriver") {
      await appendRuntimeDriverRestartAttemptedEvents(bindings, {
        targets: admittedTargets,
        targetVersion,
      });
    }

    await executeRuntimeStateOperationSubjects(bindings, {
      executionPlane,
      operation,
      operationId: phase.operationId,
      subjects: admittedSubjects,
    });
  } catch (error) {
    await failRuntimeStateOperationPhase(bindings, {
      agentId,
      operation,
      phase,
    });

    throw error;
  }

  await completeRuntimeStateOperationPhase(bindings, {
    agentId,
    operation,
    phase,
  });

  return admittedTargets.length;
}

async function executeSessionRuntimeOperation(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: SessionRuntimeOperationInput,
  operation: SessionRuntimeOperationName,
): Promise<SessionRuntimeOperationResult> {
  const project = await ensureProjectOwnership(bindings.DB, viewer.id, input.projectId);
  const sessionTarget = { ...input, executionOwnerUserId: project.ownerAccountId };
  const scope = await resolveSessionRuntimeOperationScope(bindings.DB, sessionTarget);
  await assertSessionRecoveryAvailable(bindings.DB, input.sessionId, Date.now());
  await assertSessionCheckpointReady(bindings.DB, input.sessionId);
  if (scope.targets.length === 0) {
    return { affectedSessionCount: 0, ok: true, operation, sessionId: input.sessionId };
  }
  const affectedSessionCount = await executeAdmittedRuntimeOperation(bindings, {
    agentId: scope.targets[0]!.agentId,
    operation,
    scope,
    sessionTarget,
    subjectScope: "session",
    targetVersion: null,
  });
  return { affectedSessionCount, ok: true, operation, sessionId: input.sessionId };
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

export async function restartDriver(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: RuntimeStateOperationInput,
): Promise<RuntimeStateOperationResult> {
  return executeRuntimeStateOperation({ bindings, input, operation: "restartDriver", viewer });
}

export async function recreateSandbox(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: RuntimeStateOperationInput,
): Promise<RuntimeStateOperationResult> {
  return executeRuntimeStateOperation({ bindings, input, operation: "recreateSandbox", viewer });
}

export async function resetAgentState(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: RuntimeStateOperationInput,
): Promise<RuntimeStateOperationResult> {
  return executeRuntimeStateOperation({ bindings, input, operation: "resetAgentState", viewer });
}
