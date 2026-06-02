import type { RuntimeStateTargetVersionInput } from "@mosoo/contracts/agent";
import type { AgentDeploymentVersionId } from "@mosoo/id";

import { API_ERROR_CODE, createApiError, validationError } from "../../../platform/errors";
import { isTruthy } from "../../../shared/truthiness";
import { requireAgentLiveDeploymentVersionRecord } from "../../agents/application/agent-deployment-version.service";
import { readAgentDeploymentVersionId } from "../../agents/application/agent-platform-ids";
import type { AgentRow } from "../../agents/application/agent-types";

export interface RuntimeOperationTargetVersion {
  id: AgentDeploymentVersionId;
  versionNumber: number;
}

export async function resolveRuntimeOperationTargetVersion(
  database: D1Database,
  input: {
    agent: AgentRow;
    targetVersion?: RuntimeStateTargetVersionInput | null;
  },
): Promise<RuntimeOperationTargetVersion | null> {
  if (input.agent.status !== "published") {
    if (input.targetVersion) {
      throw validationError("Draft Agent runtime operations do not accept a target version.");
    }

    return null;
  }

  if (!input.targetVersion) {
    throw createApiError(
      API_ERROR_CODE.agentLiveVersionRequired,
      "Published Agent runtime operations require the observed live deployment version.",
    );
  }

  const targetVersion = {
    id: readAgentDeploymentVersionId(input.targetVersion.id, "Target deployment version ID"),
    versionNumber: input.targetVersion.versionNumber,
  };
  const liveVersion = await requireAgentLiveDeploymentVersionRecord(database, input.agent);

  if (
    liveVersion.id !== targetVersion.id ||
    liveVersion.versionNumber !== targetVersion.versionNumber ||
    !isTruthy(input.agent.liveDeploymentVersionId)
  ) {
    throw createApiError(
      API_ERROR_CODE.agentLiveVersionConflict,
      "Published Agent live deployment version changed. Reload the Agent and retry.",
    );
  }

  return {
    id: liveVersion.id,
    versionNumber: liveVersion.versionNumber,
  };
}
