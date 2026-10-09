import type { AgentSkillReference } from "@mosoo/contracts/agent";
import { accountsTable, agentsTable, agentSkillsTable, skillsTable } from "@mosoo/db";
import type { AgentId, ProjectId, SkillId } from "@mosoo/id";
import { eq, inArray, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";

export function normalizeAgentSkillIds(skillIds: readonly SkillId[]): SkillId[] {
  return [...new Set(skillIds)];
}

// Callers have already proven Project ownership; each Skill must belong to it.
export async function ensureAgentSkillSelectionAccess(
  database: D1Database,
  viewer: AuthenticatedViewer,
  projectId: ProjectId,
  skillIds: readonly SkillId[],
): Promise<void> {
  if (skillIds.length === 0) {
    return;
  }

  const rows = await getAppDatabase(database)
    .select({
      ownerId: skillsTable.ownerAccountId,
      projectId: skillsTable.projectId,
      skillId: skillsTable.id,
    })
    .from(skillsTable)
    .where(inArray(skillsTable.id, [...skillIds]))
    .all();
  const rowsBySkillId = new Map(rows.map((row) => [row.skillId, row]));

  for (const skillId of skillIds) {
    const row = rowsBySkillId.get(skillId);

    if (row === undefined || row.projectId !== projectId || row.ownerId !== viewer.id) {
      throw new Error("Skill not found.");
    }
  }
}

export async function listResolvedAgentSkills(
  database: D1Database,
  viewer: AuthenticatedViewer,
  agentId: AgentId,
): Promise<AgentSkillReference[]> {
  const results = await getAppDatabase(database)
    .select({
      hasAccess: sql<number>`
        CASE
          WHEN ${skillsTable.id} IS NULL THEN 0
          WHEN ${skillsTable.projectId} = ${agentsTable.projectId}
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
    .where(eq(agentSkillsTable.agentId, agentId))
    .orderBy(agentSkillsTable.sortOrder)
    .all();

  return results.map((row) => ({
    ownerName: row.hasAccess === 1 ? row.ownerName : null,
    skillId: row.skillId,
    skillName: row.skillName ?? "(deleted)",
    state: row.hasAccess === 1 ? "active" : "tombstone",
  }));
}
