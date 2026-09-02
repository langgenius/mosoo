import type { AgentKind, AgentStatus } from "../agent/agent.contract";
import type {
  AccountId,
  AgentId,
  EnvironmentId,
  ProjectId,
  VendorCredentialId,
} from "../id/id.contract";
import type { OrganizationSummary } from "../organization/organization.contract";

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

export type ProjectOverviewProviderCredentialStatus = "configured";

export interface ProjectOverviewAgent {
  projectId: ProjectId;
  description: string | null;
  id: AgentId;
  kind: AgentKind;
  model: string;
  name: string;
  provider: string;
  runtimeId: string;
  status: AgentStatus;
  updatedAt: string;
}

export interface ProjectOverviewAgentList {
  hasMore: boolean;
  items: ProjectOverviewAgent[];
  limit: number;
}

export interface ProjectOverviewProviderCredential {
  projectId: ProjectId;
  hasCustomApiBase: boolean;
  id: VendorCredentialId;
  isDefault: boolean;
  modelCount: number;
  name: string;
  status: ProjectOverviewProviderCredentialStatus;
  vendorId: string;
}

export interface ProjectOverviewProviderCredentialVendorCount {
  count: number;
  defaultCredentialId: VendorCredentialId | null;
  vendorId: string;
}

export interface ProjectOverviewProviderCredentialList {
  byVendor: ProjectOverviewProviderCredentialVendorCount[];
  configuredCount: number;
  hasMore: boolean;
  items: ProjectOverviewProviderCredential[];
  limit: number;
}

export interface ProjectOverview {
  agents: ProjectOverviewAgentList;
  project: ProjectSummary;
  providerCredentials: ProjectOverviewProviderCredentialList;
}

export interface ControlPlaneOverviewProjectList {
  hasMore: boolean;
  items: ProjectOverview[];
  limit: number;
}

export interface ControlPlaneOverview {
  activeOrganization: OrganizationSummary | null;
  projects: ControlPlaneOverviewProjectList;
}
