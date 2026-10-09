import type { EnvironmentId, EnvironmentRevisionId, ProjectId } from "@mosoo/id";

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
  name: string;
  updatedAt: string;
  usedByAgentCount: number;
  projectId: ProjectId;
}

export interface EnvironmentDetail extends EnvironmentSummary {}

export interface EnvironmentVariableInput {
  key: string;
  value?: string | null;
}

export interface EnvironmentConfigInput {
  allowedHosts: string[];
  envVars: EnvironmentVariableInput[];
  networkPolicy: EnvironmentNetworkPolicy;
  packages: EnvironmentPackageSpec[];
  setupScript: string;
}

export interface CreateEnvironmentInput extends EnvironmentConfigInput {
  description?: string | null;
  name: string;
  projectId: ProjectId;
}

export interface UpdateEnvironmentInput extends EnvironmentConfigInput {
  description?: string | null;
  environmentId: EnvironmentId;
  name: string;
  projectId: ProjectId;
}

export interface DeleteEnvironmentInput {
  environmentId: EnvironmentId;
  projectId: ProjectId;
}

export interface SetProjectDefaultEnvironmentInput {
  environmentId: EnvironmentId;
  projectId: ProjectId;
}
