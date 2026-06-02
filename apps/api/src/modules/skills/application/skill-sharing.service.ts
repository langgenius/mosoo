import type {
  SetSkillAutoEnabledInput,
  ShareSkillWithOrganizationInput,
  ShareSkillWithUserInput,
  SkillAutoPreference,
  SkillShareTarget,
  UnshareSkillTargetInput,
} from "@mosoo/contracts/skill";
import { accountsTable, organizationMembersTable, skillPreferencesTable } from "@mosoo/db";
import { and, eq, isNull, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs, toIsoString } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  deleteResourceAcl,
  insertResourceAclIfAbsent,
  toOrganizationAclTarget,
  toUserAclTarget,
} from "../../resource-access/application/resource-acl.service";
import { ensureSkillAccess, ensureSkillDestructiveManager } from "./skill-access.service";

export async function setSkillAutoEnabled(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: SetSkillAutoEnabledInput,
): Promise<SkillAutoPreference> {
  const viewerId = viewer.id;
  await ensureSkillAccess(database, viewerId, input.skillId);
  const timestampMs = currentTimestampMs();

  await getAppDatabase(database)
    .insert(skillPreferencesTable)
    .values({
      accountId: viewerId,
      autoEnabled: input.autoEnabled,
      createdAt: timestampMs,
      skillId: input.skillId,
      updatedAt: timestampMs,
    })
    .onConflictDoUpdate({
      set: {
        autoEnabled: input.autoEnabled,
        updatedAt: timestampMs,
      },
      target: [skillPreferencesTable.skillId, skillPreferencesTable.accountId],
    })
    .run();

  return {
    autoEnabled: input.autoEnabled,
    skillId: input.skillId,
  };
}

export async function shareSkillWithUser(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: ShareSkillWithUserInput,
): Promise<SkillShareTarget> {
  const viewerId = viewer.id;
  const skill = await ensureSkillDestructiveManager(database, viewerId, input.skillId);
  const target =
    (await getAppDatabase(database)
      .select({
        email: accountsTable.email,
        id: accountsTable.id,
        name: accountsTable.name,
      })
      .from(organizationMembersTable)
      .innerJoin(accountsTable, eq(accountsTable.id, organizationMembersTable.accountId))
      .where(
        and(
          eq(organizationMembersTable.organizationId, skill.organizationId),
          sql`lower(${accountsTable.email}) = lower(${input.email.trim()})`,
          isNull(organizationMembersTable.disabledAt),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!target) {
    throw new Error("Organization member not found.");
  }

  if (target.id === skill.ownerId) {
    throw new Error("Owner does not need an explicit share target.");
  }

  const timestampMs = currentTimestampMs();

  const aclAssignment = await insertResourceAclIfAbsent(database, {
    assignedByAccountId: viewerId,
    createdAt: timestampMs,
    resourceId: input.skillId,
    resourceType: "skill",
    role: "user",
    target: toUserAclTarget(target.id),
  });

  return {
    createdAt: toIsoString(aclAssignment.createdAt),
    email: target.email,
    id: target.id,
    kind: "user",
    name: target.name,
  };
}

export async function shareSkillWithOrganization(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: ShareSkillWithOrganizationInput,
): Promise<SkillShareTarget> {
  const viewerId = viewer.id;
  const skill = await ensureSkillDestructiveManager(database, viewerId, input.skillId);
  const timestampMs = currentTimestampMs();

  const aclAssignment = await insertResourceAclIfAbsent(database, {
    assignedByAccountId: viewerId,
    createdAt: timestampMs,
    resourceId: input.skillId,
    resourceType: "skill",
    role: "user",
    target: toOrganizationAclTarget(skill.organizationId),
  });

  return {
    createdAt: toIsoString(aclAssignment.createdAt),
    email: null,
    id: skill.organizationId,
    kind: "organization",
    name: `Everyone in ${skill.organizationId}`,
  };
}

export async function unshareSkillTarget(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: UnshareSkillTargetInput,
): Promise<void> {
  const viewerId = viewer.id;
  await ensureSkillDestructiveManager(database, viewerId, input.skillId);

  await deleteResourceAcl(database, {
    resourceId: input.skillId,
    resourceType: "skill",
    target: {
      targetId: input.targetId,
      targetKind: input.targetKind,
    },
  });
}
