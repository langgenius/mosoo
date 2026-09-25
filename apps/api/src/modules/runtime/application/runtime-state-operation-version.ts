import type { AgentDeploymentVersionId } from "@mosoo/id";

/** Version metadata retained when reading historical maintenance events. */
export interface RuntimeOperationTargetVersion {
  id: AgentDeploymentVersionId;
  versionNumber: number;
}
