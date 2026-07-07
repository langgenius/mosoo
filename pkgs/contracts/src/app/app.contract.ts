import type { AgentKind, AgentStatus } from "../agent/agent.contract";
import type { NativeDeploymentRunResult } from "../deployment/native-deployment-run.contract";
import type {
  AccountId,
  AgentId,
  AppDeploymentId,
  AppDeploymentRunId,
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
  /**
   * Instance-global API namespace slug, minted at the App's first protocol
   * deploy and immutable afterwards; null = no protocol deploy yet (the App
   * is not name-routable).
   */
  slug: string | null;
}

export interface RenameAppInput {
  appId: AppId;
  name: string;
}

export type AppDeploymentRunStatus =
  | "activating"
  | "building"
  | "failed"
  | "preparing"
  | "queued"
  | "submitted"
  | "submitting"
  | "success";

export type AppDeploymentTargetKind = "agent_only" | "cloudflare_pages" | "cloudflare_worker";

export interface AppDeploymentRun {
  appId: AppId;
  /**
   * Absolute URL of the App's per-namespace OpenAPI document
   * (`…/api/v1/apps/{slug}/openapi.json`), derived from the minted App slug so
   * the CLI/console can point users at it after deploy. Omitted until the App
   * has a slug (no protocol deploy yet) or on surfaces that do not resolve it.
   */
  appOpenApiUrl?: string;
  createdAt: string;
  deploymentId: AppDeploymentId;
  errorCode: string | null;
  errorMessage: string | null;
  id: AppDeploymentRunId;
  liveUrl: string | null;
  /** Protocol-path run result (validate report + provisioning facts); null on legacy runs. */
  native: NativeDeploymentRunResult | null;
  plannedUrl: string;
  sourceBranch: string;
  sourceCommitSha: string;
  status: AppDeploymentRunStatus;
  targetKind: AppDeploymentTargetKind | null;
  updatedAt: string;
}

export interface AppDeployment {
  appId: AppId;
  createdAt: string;
  defaultBranch: string;
  id: AppDeploymentId;
  latestRun: AppDeploymentRun | null;
  liveUrl: string | null;
  plannedUrl: string;
  repoName: string;
  repoOwner: string;
  repoUrl: string;
  updatedAt: string;
}

export interface DeployAppInput {
  appId: AppId;
  configPath?: string | null;
  repoUrl: string;
}

export interface DeleteAppDeploymentInput {
  appId: AppId;
}

export type AppOverviewBoundAgentExposure = "public_thread";

export interface AppOverviewBoundAgent {
  agentId: AgentId;
  envVar: string;
  expose: AppOverviewBoundAgentExposure;
  name: string;
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
  boundAgents: AppOverviewBoundAgent[];
  deployment: AppDeployment | null;
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
