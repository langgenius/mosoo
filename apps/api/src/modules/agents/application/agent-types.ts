import type { Agent, AgentCollaborator } from "@mosoo/contracts/agent";
import type {
  AccountId,
  AgentDeploymentVersionId,
  AgentId,
  EnvironmentId,
  OrganizationId,
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
  prompt: string;
  provider: string;
  runtimeId: string;
  status: Agent["status"];
  updatedAt: number;
  visibility: Agent["visibility"];
  organizationId: OrganizationId;
}

export interface CollaboratorRow {
  createdAt: number;
  principal: string;
  role: AgentCollaborator["role"];
}
