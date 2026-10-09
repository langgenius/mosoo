import type { EnvironmentSummary } from "@mosoo/contracts/environment";

import { toIsoString } from "../../../time";
import {
  parsePackagesJson,
  parseStoredEnvVarsJson,
  parseStringArrayJson,
  toPublicRevisionConfig,
} from "./environment-config";
import type { EnvironmentMutableConfig, EnvironmentRecordRow } from "./environment-types";

interface EnvironmentRevisionSource {
  allowedHostsJson: string;
  envVarsJson: string;
  networkPolicy: EnvironmentMutableConfig["networkPolicy"];
  packagesJson: string;
  setupScript: string;
}

export const SYSTEM_DEFAULT_NAME = "System Default";

export function toConfig(row: EnvironmentRevisionSource): EnvironmentMutableConfig {
  return {
    allowedHosts: parseStringArrayJson(row.allowedHostsJson, "allowedHosts"),
    envVars: parseStoredEnvVarsJson(row.envVarsJson),
    networkPolicy: row.networkPolicy,
    packages: parsePackagesJson(row.packagesJson),
    setupScript: row.setupScript,
  };
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
    name: row.name,
    projectId: row.projectId,
    updatedAt: toIsoString(row.updatedAt),
    usedByAgentCount: row.usedByAgentCount,
  };
}
