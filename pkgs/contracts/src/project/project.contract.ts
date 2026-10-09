import type { AccountId, EnvironmentId, ProjectId } from "@mosoo/id";

export interface ProjectSummary {
  createdAt: string;
  defaultEnvironmentId: EnvironmentId | null;
  id: ProjectId;
  name: string;
  ownerAccountId: AccountId;
}

export interface RenameProjectInput {
  projectId: ProjectId;
  name: string;
}
