import type {
  RuntimeStateApplyActionKind,
  RuntimeStateOperationName,
} from "@mosoo/contracts/agent";

import { isTruthy } from "../../../shared/truthiness";
import {
  appendAuditEvent,
  resolveViewerAuditActor,
} from "../../audit/application/audit-query.service";
import { AUDIT_ACTION, AUDIT_RESOURCE } from "../../audit/domain/audit-vocabulary";
import type { AuditAction } from "../../audit/domain/audit-vocabulary";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import type { RuntimeOperationTargetVersion } from "./runtime-state-operation-version";
export interface RuntimeOperationAgent {
  id: string;
  name: string;
  ownerId: string;
  organizationId: string;
}

function resolveApplyActionKind(input: {
  applyActionKind?: RuntimeStateApplyActionKind | null | undefined;
  operation: RuntimeStateOperationName;
}): RuntimeStateApplyActionKind | null {
  if (input.operation === "resetAgentState") {
    return null;
  }

  if (input.operation === "recreateSandbox") {
    if (input.applyActionKind && input.applyActionKind !== "recreate-preserving-state") {
      throw new Error("recreateSandbox audit action must be recreate-preserving-state.");
    }

    return "recreate-preserving-state";
  }

  if (
    input.applyActionKind &&
    input.applyActionKind !== "restart-process" &&
    input.applyActionKind !== "patch-and-restart"
  ) {
    throw new Error("restartDriver audit action must be restart-process or patch-and-restart.");
  }

  return input.applyActionKind ?? "restart-process";
}

export function resolveRuntimeStateOperationAuditAction(input: {
  applyActionKind?: RuntimeStateApplyActionKind | null | undefined;
  operation: RuntimeStateOperationName;
}): AuditAction {
  resolveApplyActionKind(input);

  switch (input.operation) {
    case "recreateSandbox":
    case "resetAgentState":
    case "restartDriver": {
      return AUDIT_ACTION.agentUpdate;
    }
    default: {
      throw new Error("Unsupported runtime state operation.");
    }
  }
}

export async function appendRuntimeStateOperationAuditEvent(
  database: D1Database,
  input: {
    agent: RuntimeOperationAgent;
    applyActionKind?: RuntimeStateApplyActionKind | null | undefined;
    errorMessage?: string | null;
    operation: RuntimeStateOperationName;
    outcome: "failure" | "success";
    sandboxId: string;
    targetCount: number;
    targetVersion?: RuntimeOperationTargetVersion | null;
    viewer: AuthenticatedViewer;
  },
): Promise<void> {
  const applyActionKind = resolveApplyActionKind({
    applyActionKind: input.applyActionKind,
    operation: input.operation,
  });

  await appendAuditEvent(database, {
    action: AUDIT_ACTION.agentUpdate,
    ...resolveViewerAuditActor(input.viewer),
    metadata: {
      affectedSessionCount: String(input.targetCount),
      ...(isTruthy(input.errorMessage) ? { errorMessage: input.errorMessage } : {}),
      ...(applyActionKind ? { applyActionKind } : {}),
      ...(input.targetVersion
        ? {
            deploymentVersionId: input.targetVersion.id,
            deploymentVersionNumber: String(input.targetVersion.versionNumber),
          }
        : {}),
      operation: input.operation,
      sandboxId: input.sandboxId,
    },
    organizationId: input.agent.organizationId,
    outcome: input.outcome,
    resourceDisplay: input.agent.name,
    resourceId: input.agent.id,
    resourceType: AUDIT_RESOURCE.agent,
  });
}
