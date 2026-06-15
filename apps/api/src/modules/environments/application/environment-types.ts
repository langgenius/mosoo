import type {
  EnvironmentNetworkPolicy,
  EnvironmentPackageSpec,
} from "@mosoo/contracts/environment";
import type { AccountId, EnvironmentId, EnvironmentRevisionId, AppId } from "@mosoo/id";

export interface StoredEnvironmentVariable {
  key: string;
  preview: string;
  secretId: string | null;
}

export interface EnvironmentRecordRow {
  allowMcpServers: number;
  allowPackageManagers: number;
  allowedHostsJson: string;
  createdAt: number;
  currentRevisionId: EnvironmentRevisionId;
  defaultEnvironmentId: EnvironmentId | null;
  description: string;
  envVarsJson: string;
  forkedFromEnvironmentId: EnvironmentId | null;
  forkedFromEnvironmentName: string | null;
  forkedFromOwnerName: string | null;
  id: EnvironmentId;
  name: string;
  networkPolicy: EnvironmentNetworkPolicy;
  ownerId: AccountId | null;
  ownerImageUrl: string | null;
  ownerName: string | null;
  packagesJson: string;
  appId: AppId;
  setupScript: string;
  updatedAt: number;
  usedByAgentCount?: number;
}

export interface EnvironmentMutableConfig {
  allowMcpServers: boolean;
  allowPackageManagers: boolean;
  allowedHosts: string[];
  envVars: StoredEnvironmentVariable[];
  networkPolicy: EnvironmentNetworkPolicy;
  packages: EnvironmentPackageSpec[];
  setupScript: string;
}
