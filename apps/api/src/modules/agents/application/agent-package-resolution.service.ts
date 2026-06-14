import { createResolutionIssue } from "@mosoo/agent-package";
import type {
  AgentManifest,
  AgentPackage,
  AgentPackageAsset,
  AgentPackageResolutionSummary,
  AgentResolutionIssue,
} from "@mosoo/contracts/agent-manifest";
import { environmentsTable, spacesTable } from "@mosoo/db";
import type { AccountId, EnvironmentId, AppId, SkillId, SpaceId } from "@mosoo/id";
import { and, eq, sql } from "drizzle-orm";
import { zipSync } from "fflate";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { listAppSkillRows } from "../../skills/application/skill-access.service";
import { createSkillFromUpload } from "../../skills/application/skill-package-write.service";
import {
  isSpaceRoleRankSufficient,
  listSpaceAccessRows,
} from "../../spaces/domain/space-access.policy";
import {
  readEnvironmentId,
  readSkillId,
  readSkillSnapshotId,
  readSpaceId,
} from "./agent-platform-ids";
import { collectRuntimeCapabilityIssues } from "./agent-runtime-capability-resolution.service";
import { getAgentEnvironmentName } from "./agent-spec.service";
import type { AgentStoredPackageSkill } from "./agent-stored-config.service";

export interface PackageSkillResolution {
  packageSkills: AgentStoredPackageSkill[];
  skillIds: SkillId[];
}

interface PackageOwnedSkillReference {
  packagePath: string;
}

export function readAgentPackageAsset(
  agentPackage: AgentPackage,
  key: string | null,
): AgentPackageAsset | null {
  if (!isTruthy(key)) {
    return null;
  }

  return agentPackage.assets.find((asset) => asset.key === key) ?? null;
}

export function collectPackageDeclarationIssues(
  agentPackage: AgentPackage,
): AgentResolutionIssue[] {
  const issues: AgentResolutionIssue[] = [];
  const manifestEnvVarKeys = Object.keys(agentPackage.manifest.environment.envVars);
  const envVarKeys = [...new Set(manifestEnvVarKeys)].toSorted();

  for (const envVarKey of envVarKeys) {
    issues.push(
      createResolutionIssue({
        actionLabel: "Fill secret",
        code: "agent.import.environment_secret.missing",
        message: `Environment variable ${envVarKey} must be re-entered in the target App.`,
        targetLabel: envVarKey,
        targetType: "environment",
      }),
    );
  }

  return issues;
}

export async function resolvePackageSkills(input: {
  allowSourceSkillIds?: boolean;
  bindings?: ApiBindings;
  database: D1Database;
  issues: AgentResolutionIssue[];
  manifest: AgentManifest;
  packageAssets?: AgentPackageAsset[];
  appId: AppId;
  summary: AgentPackageResolutionSummary;
  viewer?: AuthenticatedViewer;
  viewerId: AccountId;
}): Promise<PackageSkillResolution> {
  const skillIds: SkillId[] = [];
  const packageSkills: AgentStoredPackageSkill[] = [];
  const accessibleSkills = await listAppSkillRows(input.database, input.viewerId, input.appId);
  const accessibleSkillsByName = new Map<string, (typeof accessibleSkills)[number]>();
  const accessibleSkillsById = new Map<string, (typeof accessibleSkills)[number]>();

  for (const skill of accessibleSkills) {
    const skillName = skill.name.toLowerCase();

    if (!accessibleSkillsByName.has(skillName)) {
      accessibleSkillsByName.set(skillName, skill);
    }

    accessibleSkillsById.set(skill.id, skill);
  }

  for (const [index, skill] of input.manifest.skills.entries()) {
    const packageReference = readPackageOwnedSkillReference(skill);
    const packageSkill = await createPackageOwnedSkillIfPresent(
      input,
      skill,
      packageReference,
      index,
    );

    if (packageSkill !== null) {
      packageSkills.push(packageSkill);
      input.summary.boundSkillCount += 1;
      continue;
    }

    if (packageReference !== null) {
      if (input.allowSourceSkillIds === true) {
        continue;
      }

      pushMissingSkillIssue(input.issues, skill);
      continue;
    }

    const matched =
      accessibleSkillsByName.get(skill.skillName.toLowerCase()) ??
      (input.allowSourceSkillIds === true
        ? (accessibleSkillsById.get(readSkillId(skill.skillId, "Source Skill ID")) ?? null)
        : null);

    if (matched === null) {
      pushMissingSkillIssue(input.issues, skill);
      continue;
    }

    skillIds.push(readSkillId(matched.id));
    input.summary.boundSkillCount += 1;
  }

  return { packageSkills, skillIds };
}

function pushMissingSkillIssue(
  issues: AgentResolutionIssue[],
  skill: AgentManifest["skills"][number],
): void {
  issues.push(
    createResolutionIssue({
      actionLabel: "Replace or remove skill",
      code: "agent.import.skill.missing",
      message: `Skill ${skill.skillName} is not available in the target context.`,
      required: false,
      severity: "warning",
      targetLabel: skill.skillName,
      targetType: "skill",
    }),
  );
}

function readPackageOwnedSkillReference(
  skill: AgentManifest["skills"][number],
): PackageOwnedSkillReference | null {
  if (skill.skillId.startsWith("package:")) {
    const packageName = skill.skillId.slice("package:".length).trim();

    if (!isTruthy(packageName)) {
      throw new Error("Package Skill reference must include a package name.");
    }

    return { packagePath: `skills/${packageName}/` };
  }

  if (skill.skillId.startsWith("skills/") && skill.skillId.endsWith("/")) {
    return { packagePath: skill.skillId };
  }

  return null;
}

async function createPackageOwnedSkillIfPresent(
  input: {
    bindings?: ApiBindings;
    manifest: AgentManifest;
    packageAssets?: AgentPackageAsset[];
    appId: AppId;
    viewer?: AuthenticatedViewer;
  },
  skill: AgentManifest["skills"][number],
  packageReference: PackageOwnedSkillReference | null,
  sortOrder: number,
): Promise<AgentStoredPackageSkill | null> {
  if (packageReference === null || !input.bindings || !input.viewer || !input.packageAssets) {
    return null;
  }

  const skillPath = packageReference.packagePath;
  const skillAssets = input.packageAssets.filter(
    (asset) => asset.role === "skill_file" && asset.key.startsWith(skillPath),
  );

  if (skillAssets.length === 0) {
    return null;
  }

  const files: Record<string, Uint8Array> = {};

  for (const asset of skillAssets) {
    const relativePath = asset.key.slice(skillPath.length);

    if (!isTruthy(relativePath)) {
      continue;
    }

    files[relativePath] = asset.contentBytes ?? new TextEncoder().encode(asset.contentText ?? "");
  }

  if (!files["SKILL.md"]) {
    return null;
  }

  const packagePath = skillPath;
  const created = await createSkillFromUpload(input.bindings, input.viewer, input.appId, {
    file: {
      bytes: zipSync(files),
      name: `${skill.skillName}.skill`,
    },
  });

  return {
    currentSnapshotId: readSkillSnapshotId(created.snapshotId, "Package skill snapshot ID"),
    ownerName: skill.ownerName,
    packagePath,
    skillId: readSkillId(created.id, "Package skill ID"),
    skillName: created.name,
    sortOrder,
  };
}

async function listTargetSpacesByName(
  database: D1Database,
  appId: AppId,
): Promise<Map<string, { id: SpaceId }>> {
  const rows = await getAppDatabase(database)
    .select({ id: spacesTable.id, name: spacesTable.name })
    .from(spacesTable)
    .where(eq(spacesTable.appId, appId))
    .all();

  return new Map(rows.map((row) => [row.name.toLowerCase(), { id: row.id }]));
}

export async function resolvePackageSpaces(input: {
  allowTargetNameMatch?: boolean;
  database: D1Database;
  issues: AgentResolutionIssue[];
  manifest: AgentManifest;
  appId: AppId;
  summary: AgentPackageResolutionSummary;
  viewerId: AccountId;
}): Promise<SpaceId[]> {
  const spaceIds: SpaceId[] = [];
  const manifestSpaces = input.manifest.spaces;
  const requestedSpaceIds = manifestSpaces
    .map((space) => space.spaceId)
    .filter((spaceId): spaceId is string => isTruthy(spaceId))
    .map((spaceId) => readSpaceId(spaceId));
  const requestedSpaceAccess = await listSpaceAccessRows(
    input.database,
    input.viewerId,
    input.appId,
    requestedSpaceIds,
  );
  const shouldMatchByName =
    input.allowTargetNameMatch !== false &&
    manifestSpaces.some((space) => isTruthy(space.expectedName));
  const targetSpacesByName = shouldMatchByName
    ? await listTargetSpacesByName(input.database, input.appId)
    : new Map<string, { id: SpaceId }>();

  for (const space of manifestSpaces) {
    const required = space.required;
    let targetSpaceId = isTruthy(space.spaceId) ? readSpaceId(space.spaceId) : null;

    if (isTruthy(targetSpaceId)) {
      const access = requestedSpaceAccess.accessibleRowsById.get(targetSpaceId);

      if (
        !access ||
        access.app_id !== input.appId ||
        !isSpaceRoleRankSufficient(access.role_rank, "read")
      ) {
        targetSpaceId = null;
      }
    }

    if (!isTruthy(targetSpaceId) && input.allowTargetNameMatch !== false) {
      targetSpaceId = isTruthy(space.expectedName)
        ? (targetSpacesByName.get(space.expectedName.toLowerCase())?.id ?? null)
        : null;
    }

    if (!isTruthy(targetSpaceId)) {
      input.issues.push(
        createResolutionIssue({
          actionLabel: "Rebind Space",
          code: "agent.import.space.missing",
          message: `Space binding ${space.alias} needs a target Space in this App.`,
          required,
          targetLabel: space.expectedName ?? space.alias,
          targetType: "space",
        }),
      );
      continue;
    }

    spaceIds.push(targetSpaceId);
    input.summary.boundSpaceCount += 1;
  }

  return spaceIds;
}

async function findEnvironmentByName(
  database: D1Database,
  appId: AppId,
  name: string | null,
): Promise<{ id: EnvironmentId } | null> {
  if (!isTruthy(name)) {
    return null;
  }

  return (
    (await getAppDatabase(database)
      .select({ id: environmentsTable.id })
      .from(environmentsTable)
      .where(
        and(
          eq(environmentsTable.appId, appId),
          sql`lower(${environmentsTable.name}) = lower(${name})`,
        ),
      )
      .limit(1)
      .get()) ?? null
  );
}

export async function resolvePackageEnvironment(input: {
  allowTargetNameMatch?: boolean;
  database: D1Database;
  issues: AgentResolutionIssue[];
  manifest: AgentManifest;
  appId: AppId;
}): Promise<EnvironmentId | null> {
  const manifestEnvironment = input.manifest.environment;

  if (isTruthy(manifestEnvironment.environmentId)) {
    const row = await getAgentEnvironmentName(
      input.database,
      readEnvironmentId(manifestEnvironment.environmentId),
    );

    if (row?.appId === input.appId) {
      return row.id;
    }
  }

  if (input.allowTargetNameMatch !== false) {
    const matched = await findEnvironmentByName(
      input.database,
      input.appId,
      manifestEnvironment.expectedName,
    );

    if (matched) {
      return matched.id;
    }
  }

  if (input.allowTargetNameMatch === false) {
    return null;
  }

  if (Boolean(manifestEnvironment.environmentId) || Boolean(manifestEnvironment.expectedName)) {
    input.issues.push(
      createResolutionIssue({
        actionLabel: "Choose Environment",
        code: "agent.import.environment.missing",
        message: "Environment reference needs a target Environment replacement.",
        targetLabel: manifestEnvironment.expectedName ?? manifestEnvironment.environmentId,
        targetType: "environment",
      }),
    );
  }

  return null;
}

export async function collectRuntimeResolutionIssues(
  database: D1Database,
  actorAccountId: AccountId,
  appId: AppId,
  manifest: AgentManifest,
): Promise<AgentResolutionIssue[]> {
  return collectRuntimeCapabilityIssues({
    actorAccountId,
    codePrefix: "agent.import",
    database,
    appId,
    selection: {
      model: manifest.runtime.model,
      provider: manifest.runtime.provider,
      runtimeId: manifest.runtime.id,
    },
  });
}
