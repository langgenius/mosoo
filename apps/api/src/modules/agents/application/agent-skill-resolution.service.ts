import type { AgentSkillReference } from "@mosoo/contracts/agent";
import {
  accountsTable,
  agentSkillsTable,
  organizationMembersTable,
  resourceAclTable,
  skillsTable,
} from "@mosoo/db";
import type { AgentId, SkillId } from "@mosoo/id";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { isOrganizationAdminRole } from "../../organizations/domain/organization-access.policy";
import { readSkillId } from "./agent-platform-ids";

export function normalizeAgentSkillIds(skillIds: readonly SkillId[]): SkillId[] {
  return [...new Set(skillIds.map((skillId) => readSkillId(skillId, "Agent skill ID")))];
}

export async function ensureAgentSkillSelectionAccess(
  database: D1Database,
  viewer: AuthenticatedViewer,
  skillIds: readonly SkillId[],
): Promise<void> {
  const uniqueSkillIds = normalizeAgentSkillIds(skillIds);

  if (uniqueSkillIds.length === 0) {
    return;
  }

  const rows = await getAppDatabase(database)
    .select({
      isShared: sql<number>`
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM ${resourceAclTable}
            WHERE ${resourceAclTable.resourceType} = 'skill'
              AND ${resourceAclTable.resourceId} = ${skillsTable.id}
              AND (
                (${resourceAclTable.targetKind} = 'user' AND ${resourceAclTable.targetId} = ${viewer.id})
                OR (
                  ${resourceAclTable.targetKind} = 'organization'
                  AND ${resourceAclTable.targetId} = ${skillsTable.organizationId}
                )
              )
          ) THEN 1
          ELSE 0
        END
      `,
      ownerId: skillsTable.ownerAccountId,
      skillId: skillsTable.id,
      viewerRole: organizationMembersTable.role,
    })
    .from(skillsTable)
    .leftJoin(
      organizationMembersTable,
      and(
        eq(organizationMembersTable.organizationId, skillsTable.organizationId),
        eq(organizationMembersTable.accountId, viewer.id),
        isNull(organizationMembersTable.disabledAt),
      ),
    )
    .where(inArray(skillsTable.id, uniqueSkillIds))
    .all();
  const rowsBySkillId = new Map(rows.map((row) => [row.skillId, row]));

  for (const skillId of uniqueSkillIds) {
    const row = rowsBySkillId.get(skillId);

    if (!row || row.viewerRole === null) {
      throw new Error("Skill not found.");
    }

    if (
      row.ownerId !== viewer.id &&
      !isOrganizationAdminRole(row.viewerRole) &&
      row.isShared !== 1
    ) {
      throw new Error("Skill not found.");
    }
  }
}

export async function listResolvedAgentSkills(
  database: D1Database,
  viewer: AuthenticatedViewer,
  agentId: AgentId,
): Promise<AgentSkillReference[]> {
  return (await listResolvedAgentSkillsByAgentIds(database, viewer, [agentId])).get(agentId) ?? [];
}

async function listResolvedAgentSkillsByAgentIds(
  database: D1Database,
  viewer: AuthenticatedViewer,
  agentIds: readonly AgentId[],
): Promise<Map<AgentId, AgentSkillReference[]>> {
  const uniqueAgentIds = [...new Set(agentIds)];
  const skillsByAgentId = new Map<AgentId, AgentSkillReference[]>(
    uniqueAgentIds.map((agentId) => [agentId, []]),
  );

  if (uniqueAgentIds.length === 0) {
    return skillsByAgentId;
  }

  const results = await getAppDatabase(database)
    .select({
      agentId: agentSkillsTable.agentId,
      hasAccess: sql<number>`
        CASE
          WHEN ${skillsTable.id} IS NULL THEN 0
          WHEN ${skillsTable.ownerAccountId} = ${viewer.id} THEN 1
          WHEN EXISTS (
            SELECT 1
            FROM resource_acl skill_acl
            WHERE skill_acl.resource_type = 'skill'
              AND skill_acl.resource_id = ${skillsTable.id}
              AND (
                (skill_acl.target_kind = 'user' AND skill_acl.target_id = ${viewer.id})
                OR (
                  skill_acl.target_kind = 'organization'
                  AND skill_acl.target_id = ${skillsTable.organizationId}
                )
              )
          ) THEN 1
          ELSE 0
        END
      `.as("hasAccess"),
      ownerName: sql`${accountsTable.name}`.mapWith(accountsTable.name).as("ownerName"),
      skillId: agentSkillsTable.skillId,
      skillName: sql`${skillsTable.name}`.mapWith(skillsTable.name).as("skillName"),
    })
    .from(agentSkillsTable)
    .leftJoin(skillsTable, eq(skillsTable.id, agentSkillsTable.skillId))
    .leftJoin(accountsTable, eq(accountsTable.id, skillsTable.ownerAccountId))
    .where(and(inArray(agentSkillsTable.agentId, uniqueAgentIds)))
    .orderBy(agentSkillsTable.agentId, agentSkillsTable.sortOrder)
    .all();

  for (const row of results) {
    skillsByAgentId.get(row.agentId)?.push({
      ownerName: row.hasAccess === 1 ? row.ownerName : null,
      skillId: row.skillId,
      skillName: row.skillName ?? "(deleted)",
      state: row.hasAccess === 1 ? "active" : "tombstone",
    });
  }

  return skillsByAgentId;
}
