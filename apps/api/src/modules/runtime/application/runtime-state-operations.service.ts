import type {
  RuntimeStateOperationInput,
  RuntimeStateOperationName,
  RuntimeStateOperationResult,
} from "@mosoo/contracts/agent";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { ensureAgentRuntimeOperationAccess } from "../../agents/application/agent-access.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { getRuntimeKindPolicy } from "../domain/runtime-kind-policy";
import { createSandboxExecutionPlaneAdapter } from "../infrastructure/execution-plane/sandbox-execution-plane-adapter";
import { enforceSandboxBackupConfigured } from "../infrastructure/sandbox-backup-config";
import { executeRuntimeStateOperationSubjects } from "./runtime-state-operation-execution";
import {
  completeRuntimeStateOperationPhase,
  failRuntimeStateOperationPhase,
  listRuntimeStateOperationPhaseTargets,
  startRuntimeStateOperationPhase,
} from "./runtime-state-operation-phases";
import {
  resolveRuntimeOperationScope,
  selectAdmittedRuntimeOperationSubjects,
} from "./runtime-state-operation-subjects";
import type { RuntimeOperationSubject } from "./runtime-state-operation-subjects";
import { appendRuntimeDriverRestartAttemptedEvents } from "./runtime-state-operation-target-events";
import { resolveRuntimeOperationTargetVersion } from "./runtime-state-operation-version";

const executionPlane = createSandboxExecutionPlaneAdapter();

async function executeRuntimeStateOperation(context: {
  bindings: ApiBindings;
  input: RuntimeStateOperationInput;
  operation: RuntimeStateOperationName;
  viewer: AuthenticatedViewer;
}): Promise<RuntimeStateOperationResult> {
  const { bindings, input, operation, viewer } = context;
  const { agent } = await ensureAgentRuntimeOperationAccess(
    bindings.DB,
    viewer.id,
    input.agentId,
    operation,
  );
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

  const { subjects, targets } = await resolveRuntimeOperationScope(bindings.DB, agent);

  const phase = await startRuntimeStateOperationPhase(bindings, {
    agentId: agent.id,
    operation,
    targetVersion,
    targets,
  });
  const admittedTargets = listRuntimeStateOperationPhaseTargets(phase);
  let admittedSubjects: RuntimeOperationSubject[] = [];

  try {
    admittedSubjects = selectAdmittedRuntimeOperationSubjects({
      admittedTargets,
      scope: policy.subject.scope,
      subjects,
      targets,
    });

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
      agentId: agent.id,
      operation,
      phase,
    });

    throw error;
  }

  await completeRuntimeStateOperationPhase(bindings, {
    agentId: agent.id,
    operation,
    phase,
  });

  return {
    affectedSessionCount: admittedTargets.length,
    agentId: agent.id,
    ok: true,
    operation,
  };
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
