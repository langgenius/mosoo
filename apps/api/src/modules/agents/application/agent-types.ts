import type { Agent } from "@mosoo/contracts/agent";
import type {
  AccountId,
  AgentDeploymentVersionId,
  AgentId,
  EnvironmentId,
  ProjectId,
} from "@mosoo/id";

export interface AgentRow {
  configJson: string;
  createdAt: number;
  description: string | null;
  environmentId: EnvironmentId | null;
  id: AgentId;
  kind: Agent["kind"];
  liveDeploymentVersionId: AgentDeploymentVersionId | null;
  model: string;
  name: string;
  ownerId: AccountId;
  projectId: ProjectId;
  prompt: string;
  provider: string;
  runtimeId: string;
  status: Agent["status"];
  updatedAt: number;
  visibility: Agent["visibility"];
}
