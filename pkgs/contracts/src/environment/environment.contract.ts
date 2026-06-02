import type {
  AccountId,
  EnvironmentId,
  EnvironmentRevisionId,
  OrganizationId,
} from "../id/id.contract";

export type EnvironmentNetworkPolicy = "full" | "limited";
export type EnvironmentPackageManager = "apt" | "cargo" | "gem" | "go" | "npm" | "pip";
export type EnvironmentRegistryRole = "owner" | "user";
export type EnvironmentShareTargetKind = "organization" | "user";
export type EnvironmentShareTargetId = AccountId | OrganizationId;

export interface EnvironmentOwnerSummary {
  id: AccountId | null;
  imageUrl: string | null;
  name: string | null;
}

export interface EnvironmentForkOrigin {
  environmentId: EnvironmentId;
  name: string;
  ownerName: string;
}

export interface EnvironmentPackageSpec {
  manager: EnvironmentPackageManager;
  packages: string[];
}

export type EnvironmentVariableStatus = "configured" | "pending";

export interface EnvironmentVariablePreview {
  key: string;
  preview: string;
  status: EnvironmentVariableStatus;
}

export interface EnvironmentRevisionConfig {
  allowMcpServers: boolean;
  allowPackageManagers: boolean;
  allowedHosts: string[];
  envVars: EnvironmentVariablePreview[];
  networkPolicy: EnvironmentNetworkPolicy;
  packages: EnvironmentPackageSpec[];
  setupScript: string;
}

export interface EnvironmentSummary extends EnvironmentRevisionConfig {
  canDelete: boolean;
  canEdit: boolean;
  createdAt: string;
  currentRevisionId: EnvironmentRevisionId;
  description: string;
  forkOrigin: EnvironmentForkOrigin | null;
  id: EnvironmentId;
  isBuiltIn: boolean;
  isDefault: boolean;
  isEditable: boolean;
  name: string;
  owner: EnvironmentOwnerSummary;
  role: EnvironmentRegistryRole;
  updatedAt: string;
  usedByAgentCount: number;
  organizationId: OrganizationId;
}

export interface EnvironmentShareTarget {
  createdAt: string;
  email: string | null;
  id: EnvironmentShareTargetId;
  kind: EnvironmentShareTargetKind;
  name: string | null;
}

export interface EnvironmentDetail extends EnvironmentSummary {
  shareTargets: EnvironmentShareTarget[];
}

export interface EnvironmentVariableInput {
  key: string;
  value?: string | null;
}

export interface SetEnvironmentVariableValueInput {
  environmentId: EnvironmentId;
  key: string;
  value: string;
}

export interface EnvironmentConfigInput {
  allowMcpServers: boolean;
  allowPackageManagers: boolean;
  allowedHosts: string[];
  envVars: EnvironmentVariableInput[];
  networkPolicy: EnvironmentNetworkPolicy;
  packages: EnvironmentPackageSpec[];
  setupScript: string;
}

export interface CreateEnvironmentInput extends EnvironmentConfigInput {
  description?: string | null;
  name: string;
  organizationId: OrganizationId;
}

export interface UpdateEnvironmentInput extends EnvironmentConfigInput {
  description?: string | null;
  environmentId: EnvironmentId;
  name: string;
}

export interface CreateEnvironmentForkInput {
  environmentId: EnvironmentId;
}

export interface DeleteEnvironmentInput {
  environmentId: EnvironmentId;
}

export interface SetOrganizationDefaultEnvironmentInput {
  environmentId: EnvironmentId;
  organizationId: OrganizationId;
}

export interface ShareEnvironmentWithUserInput {
  email: string;
  environmentId: EnvironmentId;
}

export interface ShareEnvironmentWithOrganizationInput {
  environmentId: EnvironmentId;
}

export interface UnshareEnvironmentTargetInput {
  environmentId: EnvironmentId;
  targetId: EnvironmentShareTargetId;
  targetKind: EnvironmentShareTargetKind;
}

export interface SessionEnvironmentSnapshot extends EnvironmentRevisionConfig {
  environmentId: EnvironmentId;
  environmentName: string;
  revisionId: EnvironmentRevisionId;
}
