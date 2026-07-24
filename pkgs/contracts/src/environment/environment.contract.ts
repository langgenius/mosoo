import type { AccountId, EnvironmentId, EnvironmentRevisionId, AppId } from "../id/id.contract";

export type EnvironmentNetworkPolicy = "full" | "limited";

export const ENVIRONMENT_PACKAGE_MANAGERS = ["apt", "cargo", "gem", "go", "npm", "pip"] as const;
export type EnvironmentPackageManager = (typeof ENVIRONMENT_PACKAGE_MANAGERS)[number];

export const WRITABLE_ENVIRONMENT_PACKAGE_MANAGERS = [
  "npm",
  "pip",
] as const satisfies readonly EnvironmentPackageManager[];
export type WritableEnvironmentPackageManager =
  (typeof WRITABLE_ENVIRONMENT_PACKAGE_MANAGERS)[number];

const WRITABLE_ENVIRONMENT_PACKAGE_MANAGER_SET = new Set<string>(
  WRITABLE_ENVIRONMENT_PACKAGE_MANAGERS,
);

export function isWritableEnvironmentPackageManager(
  manager: EnvironmentPackageManager,
): manager is WritableEnvironmentPackageManager {
  return WRITABLE_ENVIRONMENT_PACKAGE_MANAGER_SET.has(manager);
}

export type EnvironmentRegistryRole = "owner";

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
  appId: AppId;
}

export interface EnvironmentDetail extends EnvironmentSummary {}

export interface EnvironmentVariableInput {
  key: string;
  value?: string | null;
}

export interface SetEnvironmentVariableValueInput {
  environmentId: EnvironmentId;
  key: string;
  appId: AppId;
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
  appId: AppId;
}

export interface UpdateEnvironmentInput extends EnvironmentConfigInput {
  description?: string | null;
  environmentId: EnvironmentId;
  name: string;
  appId: AppId;
}

export interface CreateEnvironmentForkInput {
  environmentId: EnvironmentId;
  appId: AppId;
}

export interface DeleteEnvironmentInput {
  environmentId: EnvironmentId;
  appId: AppId;
}

export interface SetAppDefaultEnvironmentInput {
  environmentId: EnvironmentId;
  appId: AppId;
}

export interface SessionEnvironmentSnapshot extends EnvironmentRevisionConfig {
  environmentId: EnvironmentId;
  environmentName: string;
  revisionId: EnvironmentRevisionId;
}
