import type { AgentSkillReference } from "@mosoo/contracts/agent";
import { accountsTable, agentsTable, agentSkillsTable, skillsTable } from "@mosoo/db";
import type { AgentId, AppId, SkillId } from "@mosoo/id";
import { and, eq, inArray, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { ensureAppOwnership } from "../../apps/application/app.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { readSkillId } from "./agent-platform-ids";

export function normalizeAgentSkillIds(skillIds: readonly SkillId[]): SkillId[] {
  return [...new Set(skillIds.map((skillId) => readSkillId(skillId, "Agent skill ID")))];
}

export async function ensureAgentSkillSelectionAccess(
  database: D1Database,
  viewer: AuthenticatedViewer,
  appId: AppId,
  skillIds: readonly SkillId[],
): Promise<void> {
  const uniqueSkillIds = normalizeAgentSkillIds(skillIds);

  if (uniqueSkillIds.length === 0) {
    return;
  }

  await ensureAppOwnership(database, viewer.id, appId);

  const rows = await getAppDatabase(database)
    .select({
      ownerId: skillsTable.ownerAccountId,
      appId: skillsTable.appId,
      skillId: skillsTable.id,
    })
    .from(skillsTable)
    .where(inArray(skillsTable.id, uniqueSkillIds))
    .all();
  const rowsBySkillId = new Map(rows.map((row) => [row.skillId, row]));

  for (const skillId of uniqueSkillIds) {
    const row = rowsBySkillId.get(skillId);

    if (row === undefined || row.appId !== appId || row.ownerId !== viewer.id) {
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
          WHEN ${skillsTable.appId} = ${agentsTable.appId}
            AND ${skillsTable.ownerAccountId} = ${viewer.id}
          THEN 1
          ELSE 0
        END
      `.as("hasAccess"),
      ownerName: sql`${accountsTable.name}`.mapWith(accountsTable.name).as("ownerName"),
      skillId: agentSkillsTable.skillId,
      skillName: sql`${skillsTable.name}`.mapWith(skillsTable.name).as("skillName"),
    })
    .from(agentSkillsTable)
    .innerJoin(agentsTable, eq(agentsTable.id, agentSkillsTable.agentId))
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
