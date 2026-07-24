import {
  isWritableEnvironmentPackageManager,
  WRITABLE_ENVIRONMENT_PACKAGE_MANAGERS,
} from "@mosoo/contracts/environment";
import type {
  CreateEnvironmentInput,
  EnvironmentDetail,
  EnvironmentNetworkPolicy,
  EnvironmentPackageManager,
  EnvironmentSummary,
  EnvironmentVariableStatus,
  UpdateEnvironmentInput,
} from "@mosoo/contracts/environment";

import { toEnvironmentId, toAppId } from "@/routes/typed-id";

type EnvironmentLike = EnvironmentSummary | EnvironmentDetail;

export interface EditableEnvVar {
  id: string;
  key: string;
  preview: string | null;
  status: EnvironmentVariableStatus;
  value: string;
}

export interface EditablePackageRow {
  id: string;
  manager: EnvironmentPackageManager | null;
  packagesText: string;
}

export interface EnvironmentDraft {
  allowMcpServers: boolean;
  allowPackageManagers: boolean;
  allowedHostsText: string;
  description: string;
  envVars: EditableEnvVar[];
  name: string;
  networkPolicy: EnvironmentNetworkPolicy;
  packages: EditablePackageRow[];
  setupScript: string;
}

export const PACKAGE_MANAGERS = WRITABLE_ENVIRONMENT_PACKAGE_MANAGERS;
const WRITABLE_PACKAGE_MANAGER_NAMES = WRITABLE_ENVIRONMENT_PACKAGE_MANAGERS.join(" or ");

export const PACKAGE_MANAGER_LABELS: Record<EnvironmentPackageManager, string> = {
  apt: "apt",
  cargo: "cargo",
  gem: "gem",
  go: "go",
  npm: "npm",
  pip: "pip",
};

export const NETWORK_POLICY_LABELS: Record<EnvironmentNetworkPolicy, string> = {
  full: "Full",
  limited: "Limited",
};

function unsupportedPackageManagerMessage(manager: EnvironmentPackageManager): string {
  return `${PACKAGE_MANAGER_LABELS[manager]} is not supported by the current Driver runtime. Change it to ${WRITABLE_PACKAGE_MANAGER_NAMES}, or remove this row before saving.`;
}

export function createDraftId(): string {
  if ("randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `env-var-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createPackageRow(
  manager: EnvironmentPackageManager | null = null,
  packagesText = "",
): EditablePackageRow {
  return {
    id: createDraftId(),
    manager,
    packagesText,
  };
}

function emptyDraft(): EnvironmentDraft {
  return {
    allowMcpServers: true,
    allowPackageManagers: true,
    allowedHostsText: "",
    description: "",
    envVars: [],
    name: "",
    networkPolicy: "full",
    packages: [createPackageRow()],
    setupScript: "",
  };
}

export function createEnvironmentDraft(environment?: EnvironmentLike | null): EnvironmentDraft {
  if (!environment) {
    return emptyDraft();
  }

  const packages =
    environment.packages.length > 0
      ? environment.packages.map((entry) =>
          createPackageRow(entry.manager, entry.packages.join(" ")),
        )
      : [createPackageRow()];

  return {
    allowMcpServers: environment.allowMcpServers,
    allowPackageManagers: environment.allowPackageManagers,
    allowedHostsText: environment.allowedHosts.join(", "),
    description: environment.description,
    envVars: environment.envVars.map((envVar) => ({
      id: createDraftId(),
      key: envVar.key,
      preview: envVar.preview,
      status: envVar.status,
      value: "",
    })),
    name: environment.name,
    networkPolicy: environment.networkPolicy,
    packages,
    setupScript: environment.setupScript,
  };
}

function parseAllowedHosts(text: string): string[] {
  return text.split(/[,\n]/u).flatMap((host) => {
    const trimmed = host.trim();
    return trimmed ? [trimmed] : [];
  });
}

function parsePackages(rows: EditablePackageRow[]) {
  return rows.flatMap((row) => {
    if (!row.manager) {
      return [];
    }

    const packages = row.packagesText.split(/\s+/u).flatMap((entry) => {
      const trimmed = entry.trim();
      return trimmed ? [trimmed] : [];
    });

    if (packages.length > 0 && !isWritableEnvironmentPackageManager(row.manager)) {
      throw new Error(unsupportedPackageManagerMessage(row.manager));
    }

    return packages.length > 0
      ? [
          {
            manager: row.manager,
            packages,
          },
        ]
      : [];
  });
}

function toEnvVarInputs(envVars: EditableEnvVar[]) {
  return envVars.flatMap((envVar) => {
    const key = envVar.key.trim();
    return key ? [{ key, value: envVar.value }] : [];
  });
}

export function getPackageManagerError(rows: EditablePackageRow[]): string | null {
  const invalidRow = rows.find((row) => row.packagesText.trim() && !row.manager);

  if (invalidRow) {
    return "Choose a package manager for every package row.";
  }

  const unsupportedRow = rows.find(
    (row) =>
      row.packagesText.trim() &&
      row.manager !== null &&
      !isWritableEnvironmentPackageManager(row.manager),
  );

  if (unsupportedRow?.manager) {
    return unsupportedPackageManagerMessage(unsupportedRow.manager);
  }

  return null;
}

export function toCreateEnvironmentInput(
  appId: string,
  draft: EnvironmentDraft,
): CreateEnvironmentInput {
  return {
    allowMcpServers: draft.allowMcpServers,
    allowPackageManagers: draft.allowPackageManagers,
    allowedHosts:
      draft.networkPolicy === "limited" ? parseAllowedHosts(draft.allowedHostsText) : [],
    description: draft.description.trim() || null,
    envVars: toEnvVarInputs(draft.envVars),
    name: draft.name.trim(),
    networkPolicy: draft.networkPolicy,
    packages: parsePackages(draft.packages),
    appId: toAppId(appId),
    setupScript: draft.setupScript,
  };
}

export function toUpdateEnvironmentInput(
  appId: string,
  environmentId: string,
  draft: EnvironmentDraft,
): UpdateEnvironmentInput {
  return {
    allowMcpServers: draft.allowMcpServers,
    allowPackageManagers: draft.allowPackageManagers,
    allowedHosts:
      draft.networkPolicy === "limited" ? parseAllowedHosts(draft.allowedHostsText) : [],
    description: draft.description.trim() || null,
    envVars: toEnvVarInputs(draft.envVars),
    environmentId: toEnvironmentId(environmentId),
    name: draft.name.trim(),
    networkPolicy: draft.networkPolicy,
    packages: parsePackages(draft.packages),
    appId: toAppId(appId),
    setupScript: draft.setupScript,
  };
}
