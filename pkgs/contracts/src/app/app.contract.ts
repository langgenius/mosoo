import type { AgentKind, AgentStatus } from "../agent/agent.contract";
import type {
  AccountId,
  AgentId,
  AppVibeAppId,
  EnvironmentId,
  AppId,
  VendorCredentialId,
} from "../id/id.contract";
import type { OrganizationSummary } from "../organization/organization.contract";

export interface AppSummary {
  createdAt: string;
  defaultEnvironmentId: EnvironmentId | null;
  id: AppId;
  name: string;
  ownerAccountId: AccountId;
}

export interface RenameAppInput {
  appId: AppId;
  name: string;
}

export type AppVibeAppStatus = "creating" | "generating" | "ready";

export interface AppVibeApp {
  appId: AppId;
  createdAt: string;
  id: AppVibeAppId;
  lastPublishedAt: string | null;
  previewUrl: string | null;
  productionUrl: string | null;
  status: AppVibeAppStatus;
  title: string | null;
  updatedAt: string;
  vibeAppId: string | null;
}

export interface AppVibeAppCloneUrl {
  cloneUrl: string;
  expiresAt: string;
}

export interface CreateAppVibeAppInput {
  appId: AppId;
  prompt: string;
}

export interface SendAppVibeAppPromptInput {
  appId: AppId;
  prompt: string;
}

export interface AppVibeAppTargetInput {
  appId: AppId;
}

export type AppOverviewProviderCredentialStatus = "configured";

export interface AppOverviewAgent {
  appId: AppId;
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

export interface AppOverviewAgentList {
  hasMore: boolean;
  items: AppOverviewAgent[];
  limit: number;
}

export interface AppOverviewProviderCredential {
  appId: AppId;
  hasCustomApiBase: boolean;
  id: VendorCredentialId;
  isDefault: boolean;
  modelCount: number;
  name: string;
  status: AppOverviewProviderCredentialStatus;
  vendorId: string;
}

export interface AppOverviewProviderCredentialVendorCount {
  count: number;
  defaultCredentialId: VendorCredentialId | null;
  vendorId: string;
}

export interface AppOverviewProviderCredentialList {
  byVendor: AppOverviewProviderCredentialVendorCount[];
  configuredCount: number;
  hasMore: boolean;
  items: AppOverviewProviderCredential[];
  limit: number;
}

export interface AppOverview {
  agents: AppOverviewAgentList;
  app: AppSummary;
  providerCredentials: AppOverviewProviderCredentialList;
}

export interface ControlPlaneOverviewAppList {
  hasMore: boolean;
  items: AppOverview[];
  limit: number;
}

export interface ControlPlaneOverview {
  activeOrganization: OrganizationSummary | null;
  apps: ControlPlaneOverviewAppList;
}
