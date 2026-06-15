import type { EnvironmentConfigInput, EnvironmentSummary } from "@mosoo/contracts/environment";

import { toIsoString } from "../../../time";
import {
  normalizeEnvironmentConfigInput,
  parsePackagesJson,
  parseStoredEnvVarsJson,
  parseStringArrayJson,
  toPublicRevisionConfig,
} from "./environment-config";
import type { EnvironmentMutableConfig, EnvironmentRecordRow } from "./environment-types";

interface EnvironmentRevisionSource {
  allowMcpServers: number;
  allowPackageManagers: number;
  allowedHostsJson: string;
  envVarsJson: string;
  networkPolicy: EnvironmentMutableConfig["networkPolicy"];
  packagesJson: string;
  setupScript: string;
}

export const SYSTEM_DEFAULT_NAME = "System Default";

export function toConfig(row: EnvironmentRevisionSource): EnvironmentMutableConfig {
  return {
    allowMcpServers: row.allowMcpServers === 1,
    allowPackageManagers: row.allowPackageManagers === 1,
    allowedHosts: parseStringArrayJson(row.allowedHostsJson, "allowedHosts"),
    envVars: parseStoredEnvVarsJson(row.envVarsJson),
    networkPolicy: row.networkPolicy,
    packages: parsePackagesJson(row.packagesJson),
    setupScript: row.setupScript,
  };
}

export function normalizeConfigForCreate(
  input: EnvironmentConfigInput,
): Omit<EnvironmentMutableConfig, "envVars"> {
  return normalizeEnvironmentConfigInput(input);
}

export function toEnvironmentSummary(row: EnvironmentRecordRow): EnvironmentSummary {
  const config = toConfig(row);
  const isBuiltIn = row.ownerId === null;
  const canEdit = !isBuiltIn;
  const isDefault = row.defaultEnvironmentId === row.id;
  const publicConfig = toPublicRevisionConfig(config);
  const forkedFromEnvironmentId = row.forkedFromEnvironmentId;
  const forkedFromEnvironmentName = row.forkedFromEnvironmentName;
  const forkedFromOwnerName = row.forkedFromOwnerName;

  return {
    ...publicConfig,
    canDelete: canEdit && !isDefault,
    canEdit,
    createdAt: toIsoString(row.createdAt),
    currentRevisionId: row.currentRevisionId,
    description: row.description,
    forkOrigin:
      forkedFromEnvironmentId && forkedFromEnvironmentName && forkedFromOwnerName
        ? {
            environmentId: forkedFromEnvironmentId,
            name: forkedFromEnvironmentName,
            ownerName: forkedFromOwnerName,
          }
        : null,
    id: row.id,
    isBuiltIn,
    isDefault,
    isEditable: !isBuiltIn,
    name: row.name,
    owner: {
      id: row.ownerId,
      imageUrl: row.ownerImageUrl,
      name: row.ownerName,
    },
    appId: row.appId,
    role: "owner",
    updatedAt: toIsoString(row.updatedAt),
    usedByAgentCount: row.usedByAgentCount ?? 0,
  };
}
