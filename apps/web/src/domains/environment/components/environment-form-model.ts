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
import type { EnvironmentId, ProjectId } from "@mosoo/id";

import { toProjectId } from "@/routes/typed-id";

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

export const NETWORK_POLICY_LABELS: Record<EnvironmentNetworkPolicy, string> = {
  full: "environments.networkPolicyFull",
  limited: "environments.networkPolicyLimited",
};

type Translate = (key: string, variables?: Record<string, string>) => string;

function unsupportedPackageManagerMessage(
  manager: EnvironmentPackageManager,
  t: Translate,
): string {
  return t("environments.packageManagerNotSupported", {
    manager,
    writable: WRITABLE_PACKAGE_MANAGER_NAMES,
  });
}

export function createDraftId(): string {
  return crypto.randomUUID();
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

function parsePackages(rows: EditablePackageRow[], t: Translate) {
  return rows.flatMap((row) => {
    if (!row.manager) {
      return [];
    }

    const packages = row.packagesText.split(/\s+/u).flatMap((entry) => {
      const trimmed = entry.trim();
      return trimmed ? [trimmed] : [];
    });

    if (packages.length > 0 && !isWritableEnvironmentPackageManager(row.manager)) {
      throw new Error(unsupportedPackageManagerMessage(row.manager, t));
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

export function getPackageManagerError(rows: EditablePackageRow[], t: Translate): string | null {
  const invalidRow = rows.find((row) => row.packagesText.trim() && !row.manager);

  if (invalidRow) {
    return t("environments.choosePackageManager");
  }

  const unsupportedRow = rows.find(
    (row) =>
      row.packagesText.trim() &&
      row.manager !== null &&
      !isWritableEnvironmentPackageManager(row.manager),
  );

  if (unsupportedRow?.manager) {
    return unsupportedPackageManagerMessage(unsupportedRow.manager, t);
  }

  return null;
}

export function toCreateEnvironmentInput(
  projectId: string,
  draft: EnvironmentDraft,
  t: Translate,
): CreateEnvironmentInput {
  return {
    allowedHosts:
      draft.networkPolicy === "limited" ? parseAllowedHosts(draft.allowedHostsText) : [],
    description: draft.description.trim() || null,
    envVars: toEnvVarInputs(draft.envVars),
    name: draft.name.trim(),
    networkPolicy: draft.networkPolicy,
    packages: parsePackages(draft.packages, t),
    projectId: toProjectId(projectId),
    setupScript: draft.setupScript,
  };
}

export function toUpdateEnvironmentInput(
  projectId: ProjectId,
  environmentId: EnvironmentId,
  draft: EnvironmentDraft,
  t: Translate,
): UpdateEnvironmentInput {
  return {
    allowedHosts:
      draft.networkPolicy === "limited" ? parseAllowedHosts(draft.allowedHostsText) : [],
    description: draft.description.trim() || null,
    envVars: toEnvVarInputs(draft.envVars),
    environmentId,
    name: draft.name.trim(),
    networkPolicy: draft.networkPolicy,
    packages: parsePackages(draft.packages, t),
    projectId,
    setupScript: draft.setupScript,
  };
}
