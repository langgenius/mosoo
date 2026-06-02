import type {
  AgentCollaboratorRole,
  AgentOwnerSummary,
  AgentToolSummary,
} from "@mosoo/contracts/agent";
import type { OrganizationMemberRole } from "@mosoo/contracts/organization";
import {
  accountsTable,
  agentMcpBindingsTable,
  agentSkillsTable,
  agentsTable,
  mcpServersTable,
  organizationMembersTable,
  resourceAclTable,
} from "@mosoo/db";
import type {
  AccountId,
  AgentDeploymentVersionId,
  AgentId,
  EnvironmentId,
  OrganizationId,
  SkillId,
} from "@mosoo/id";
import type { SQL } from "drizzle-orm";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { notFoundError } from "../../../platform/errors";
import {
  readAccountId,
  readAgentDeploymentVersionId,
  readAgentId,
  readEnvironmentId,
  readMcpServerId,
  readOrganizationId,
} from "./agent-platform-ids";
import { normalizeAgentSkillIds } from "./agent-skill-resolution.service";
import { normalizeAgentStoredConfigJson } from "./agent-stored-config.service";
import type { AgentRow, CollaboratorRow } from "./agent-types";

export interface AgentAccessRecord {
  agent: AgentRow;
  hasPersonalMcpBindings: boolean;
  owner: AgentOwnerSummary;
  ownerMembershipActive: boolean;
  viewerAclRoleRank: number;
  viewerMembershipDisabledAt: number | null;
  viewerMembershipRole: OrganizationMemberRole | null;
}

export interface AgentViewerAccessFacts {
  viewerAclRoleRank: number;
  viewerMembershipDisabledAt: number | null;
  viewerMembershipRole: OrganizationMemberRole | null;
}

export interface VisibleAgentAccessRow {
  agent: AgentRow;
  hasPersonalMcpBindings: boolean;
  viewerAclRoleRank: number;
}

const agentOwnerMembersTable = alias(organizationMembersTable, "agent_owner_member");
const agentViewerMembersTable = alias(organizationMembersTable, "agent_viewer_member");

export const agentRowColumns = {
  configJson: agentsTable.configJson,
  createdAt: agentsTable.createdAt,
  description: agentsTable.description,
  environmentId: agentsTable.environmentId,
  id: agentsTable.id,
  kind: agentsTable.kind,
  liveDeploymentVersionId: agentsTable.liveDeploymentVersionId,
  model: agentsTable.model,
  name: agentsTable.name,
  organizationId: agentsTable.organizationId,
  ownerId: agentsTable.ownerId,
  prompt: agentsTable.prompt,
  provider: agentsTable.provider,
  runtimeId: agentsTable.runtimeId,
  status: agentsTable.status,
  updatedAt: agentsTable.updatedAt,
  visibility: agentsTable.visibility,
};

type RawAgentRow = {
  configJson: string;
  createdAt: number;
  description: string | null;
  environmentId: EnvironmentId | null;
  id: AgentId;
  kind: AgentRow["kind"];
  liveDeploymentVersionId: AgentDeploymentVersionId | null;
  model: string;
  name: string;
  organizationId: OrganizationId;
  ownerId: AccountId;
  prompt: string;
  provider: string;
  runtimeId: string;
  status: AgentRow["status"];
  updatedAt: number;
  visibility: AgentRow["visibility"];
};

function toAgentRow(row: RawAgentRow): AgentRow {
  return {
    ...row,
    configJson: normalizeAgentStoredConfigJson(row.configJson),
    environmentId:
      row.environmentId === null
        ? null
        : readEnvironmentId(row.environmentId, "Agent environment ID"),
    id: readAgentId(row.id, "Agent ID"),
    liveDeploymentVersionId:
      row.liveDeploymentVersionId === null
        ? null
        : readAgentDeploymentVersionId(
            row.liveDeploymentVersionId,
            "Agent live deployment version ID",
          ),
    organizationId: readOrganizationId(row.organizationId, "Agent organization ID"),
    ownerId: readAccountId(row.ownerId, "Agent owner ID"),
  };
}

function toCollaboratorRole(role: string): AgentCollaboratorRole {
  if (role === "admin" || role === "user") {
    return role;
  }

  throw new Error(`Unsupported agent collaborator role: ${role}.`);
}

function viewerAgentAclRoleRankSql(input: {
  organizationId: SQL<string>;
  resourceId: SQL<string>;
  viewerId: AccountId;
}): SQL<number> {
  return sql<number>`COALESCE(
    (
      SELECT MAX(
        CASE ${resourceAclTable.role}
          WHEN 'admin' THEN 2
          WHEN 'user' THEN 1
          ELSE 0
        END
      )
      FROM ${resourceAclTable}
      WHERE ${resourceAclTable.resourceType} = 'agent'
        AND ${resourceAclTable.resourceId} = ${input.resourceId}
        AND (
          (
            ${resourceAclTable.targetKind} = 'user'
            AND ${resourceAclTable.targetId} = ${input.viewerId}
          )
          OR (
            ${resourceAclTable.targetKind} = 'organization'
            AND ${resourceAclTable.targetId} = ${input.organizationId}
          )
        )
    ),
    0
  )`;
}

function agentPersonalMcpBindingsExistSql(agentId: SQL<string>): SQL<number> {
  // drizzle's raw sql`` interpolation renders bare column names without table
  // prefix inside a subquery, which collides when both joined tables have an
  // `id` column (SQLite: "ambiguous column name: id"). Explicitly qualify
  // every column with its table identifier to disambiguate.
  return sql<number>`
    EXISTS (
      SELECT 1
      FROM ${agentMcpBindingsTable}
      INNER JOIN ${mcpServersTable}
        ON ${mcpServersTable}."id" = ${agentMcpBindingsTable}."server_id"
      WHERE ${agentMcpBindingsTable}."agent_id" = ${agentId}
        AND ${mcpServersTable}."source" = 'personal'
    )
  `;
}

export async function getAgentRow(database: D1Database, agentId: string): Promise<AgentRow> {
  const normalizedAgentId = readAgentId(agentId);
  const row = await getAppDatabase(database)
    .select(agentRowColumns)
    .from(agentsTable)
    .where(eq(agentsTable.id, normalizedAgentId))
    .limit(1)
    .get();

  if (!row) {
    throw notFoundError("Agent not found.");
  }

  return toAgentRow(row);
}

export async function getAgentAccessRecord(
  database: D1Database,
  viewerId: AccountId,
  agentId: string,
): Promise<AgentAccessRecord> {
  const normalizedAgentId = readAgentId(agentId);
  const row =
    (await getAppDatabase(database)
      .select({
        ...agentRowColumns,
        hasPersonalMcpBindings: agentPersonalMcpBindingsExistSql(
          sql<string>`${agentsTable.id}`,
        ).mapWith(Number),
        ownerImageUrl: accountsTable.image,
        ownerName: accountsTable.name,
        ownerMembershipActive: sql<number>`CASE
          WHEN ${agentOwnerMembersTable.accountId} IS NOT NULL
            AND ${agentOwnerMembersTable.disabledAt} IS NULL
          THEN 1
          ELSE 0
        END`.mapWith(Number),
        viewerAclRoleRank: viewerAgentAclRoleRankSql({
          organizationId: sql<string>`${agentsTable.organizationId}`,
          resourceId: sql<string>`${agentsTable.id}`,
          viewerId,
        }).mapWith(Number),
        viewerMembershipDisabledAt: agentViewerMembersTable.disabledAt,
        viewerMembershipRole: agentViewerMembersTable.role,
      })
      .from(agentsTable)
      .leftJoin(
        agentViewerMembersTable,
        and(
          eq(agentViewerMembersTable.organizationId, agentsTable.organizationId),
          eq(agentViewerMembersTable.accountId, viewerId),
        ),
      )
      .leftJoin(
        agentOwnerMembersTable,
        and(
          eq(agentOwnerMembersTable.organizationId, agentsTable.organizationId),
          eq(agentOwnerMembersTable.accountId, agentsTable.ownerId),
        ),
      )
      .leftJoin(accountsTable, eq(accountsTable.id, agentsTable.ownerId))
      .where(eq(agentsTable.id, normalizedAgentId))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw notFoundError("Agent not found.");
  }

  const {
    hasPersonalMcpBindings: hasPersonalMcpBindingsValue,
    ownerImageUrl,
    ownerMembershipActive: ownerMembershipActiveValue,
    ownerName,
    viewerAclRoleRank,
    viewerMembershipDisabledAt,
    viewerMembershipRole,
    ...agent
  } = row;

  return {
    agent: toAgentRow(agent),
    hasPersonalMcpBindings: hasPersonalMcpBindingsValue > 0,
    owner: {
      id: readAccountId(agent.ownerId, "Agent owner ID"),
      imageUrl: ownerImageUrl,
      name: ownerName,
    },
    ownerMembershipActive: ownerMembershipActiveValue > 0,
    viewerAclRoleRank,
    viewerMembershipDisabledAt,
    viewerMembershipRole,
  };
}

export async function getAgentViewerAccessFacts(
  database: D1Database,
  viewerId: AccountId,
  agent: Pick<AgentRow, "id" | "organizationId">,
): Promise<AgentViewerAccessFacts> {
  const row =
    (await getAppDatabase(database)
      .select({
        viewerAclRoleRank: viewerAgentAclRoleRankSql({
          organizationId: sql<string>`${agent.organizationId}`,
          resourceId: sql<string>`${agent.id}`,
          viewerId,
        }).mapWith(Number),
        viewerMembershipDisabledAt: organizationMembersTable.disabledAt,
        viewerMembershipRole: organizationMembersTable.role,
      })
      .from(organizationMembersTable)
      .where(
        and(
          eq(organizationMembersTable.organizationId, agent.organizationId),
          eq(organizationMembersTable.accountId, viewerId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  return (
    row ?? {
      viewerAclRoleRank: 0,
      viewerMembershipDisabledAt: null,
      viewerMembershipRole: null,
    }
  );
}

export async function listVisibleAgentAccessRowsForOrganization(
  database: D1Database,
  input: {
    includeAllAgents: boolean;
    organizationId: OrganizationId;
    viewerId: AccountId;
  },
): Promise<VisibleAgentAccessRow[]> {
  const viewerAclRoleRankExpression = viewerAgentAclRoleRankSql({
    organizationId: sql<string>`${agentsTable.organizationId}`,
    resourceId: sql<string>`${agentsTable.id}`,
    viewerId: input.viewerId,
  });
  const filters = [eq(agentsTable.organizationId, input.organizationId)];

  if (!input.includeAllAgents) {
    filters.push(
      or(eq(agentsTable.ownerId, input.viewerId), sql`${viewerAclRoleRankExpression} > 0`)!,
    );
  }

  const rows = await getAppDatabase(database)
    .select({
      ...agentRowColumns,
      hasPersonalMcpBindings: agentPersonalMcpBindingsExistSql(
        sql<string>`${agentsTable.id}`,
      ).mapWith(Number),
      viewerAclRoleRank: viewerAclRoleRankExpression.mapWith(Number),
    })
    .from(agentsTable)
    .where(and(...filters))
    .orderBy(desc(agentsTable.updatedAt))
    .all();

  return rows.map(
    ({ hasPersonalMcpBindings: personalMcpBindingCount, viewerAclRoleRank, ...agent }) => ({
      agent: toAgentRow(agent),
      hasPersonalMcpBindings: personalMcpBindingCount > 0,
      viewerAclRoleRank,
    }),
  );
}

export async function listAgentCollaboratorRows(
  database: D1Database,
  agentId: AgentId,
): Promise<CollaboratorRow[]> {
  return (await listAgentCollaboratorRowsByAgentIds(database, [agentId])).get(agentId) ?? [];
}

async function listAgentCollaboratorRowsByAgentIds(
  database: D1Database,
  agentIds: readonly AgentId[],
): Promise<Map<AgentId, CollaboratorRow[]>> {
  const uniqueAgentIds = [...new Set(agentIds)];
  const collaboratorsByAgentId = new Map<AgentId, CollaboratorRow[]>(
    uniqueAgentIds.map((agentId) => [agentId, []]),
  );

  if (uniqueAgentIds.length === 0) {
    return collaboratorsByAgentId;
  }

  const rows = await getAppDatabase(database)
    .select({
      agentId: resourceAclTable.resourceId,
      createdAt: resourceAclTable.createdAt,
      principal: sql<string>`
        CASE ${resourceAclTable.targetKind}
          WHEN 'organization' THEN '*'
          ELSE ${resourceAclTable.targetId}
        END
      `.as("principal"),
      role: resourceAclTable.role,
    })
    .from(resourceAclTable)
    .where(
      and(
        eq(resourceAclTable.resourceType, "agent"),
        inArray(resourceAclTable.resourceId, uniqueAgentIds),
      ),
    )
    .all();

  for (const row of rows) {
    const agentId = readAgentId(row.agentId);

    collaboratorsByAgentId.get(agentId)?.push({
      createdAt: row.createdAt,
      principal: row.principal,
      role: toCollaboratorRole(row.role),
    });
  }

  return collaboratorsByAgentId;
}

export async function hasPersonalMcpBindings(
  database: D1Database,
  agentId: AgentId,
): Promise<boolean> {
  const row = await getAppDatabase(database)
    .select({ agentId: agentMcpBindingsTable.agentId })
    .from(agentMcpBindingsTable)
    .innerJoin(mcpServersTable, eq(mcpServersTable.id, agentMcpBindingsTable.serverId))
    .where(and(eq(agentMcpBindingsTable.agentId, agentId), eq(mcpServersTable.source, "personal")))
    .limit(1)
    .get();

  return Boolean(row);
}

export async function replaceAgentSkills(
  database: D1Database,
  agentId: AgentId,
  skillIds: readonly SkillId[],
  timestampMs: number,
): Promise<void> {
  const db = getAppDatabase(database);
  const normalizedSkillIds = normalizeAgentSkillIds(skillIds);

  await db.delete(agentSkillsTable).where(eq(agentSkillsTable.agentId, agentId)).run();

  if (normalizedSkillIds.length === 0) {
    return;
  }

  await db
    .insert(agentSkillsTable)
    .values(
      normalizedSkillIds.map((skillId, index) => ({
        agentId,
        createdAt: timestampMs,
        skillId,
        sortOrder: index,
      })),
    )
    .run();
}

export async function listAgentOwnerSummaries(
  database: D1Database,
  ownerIds: readonly AccountId[],
): Promise<Map<AccountId, AgentOwnerSummary>> {
  const uniqueOwnerIds = [...new Set(ownerIds)];
  const ownersById = new Map<AccountId, AgentOwnerSummary>(
    uniqueOwnerIds.map((ownerId) => [
      ownerId,
      {
        id: readAccountId(ownerId, "Agent owner ID"),
        imageUrl: null,
        name: null,
      },
    ]),
  );

  if (uniqueOwnerIds.length === 0) {
    return ownersById;
  }

  const owners = await getAppDatabase(database)
    .select({
      id: accountsTable.id,
      imageUrl: accountsTable.image,
      name: accountsTable.name,
    })
    .from(accountsTable)
    .where(inArray(accountsTable.id, uniqueOwnerIds))
    .all();

  for (const owner of owners) {
    ownersById.set(owner.id, {
      id: readAccountId(owner.id, "Agent owner ID"),
      imageUrl: owner.imageUrl,
      name: owner.name,
    });
  }

  return ownersById;
}

export async function listAgentToolSummaries(
  database: D1Database,
  agentId: AgentId,
): Promise<AgentToolSummary[]> {
  return (await listAgentToolSummariesByAgentIds(database, [agentId])).get(agentId) ?? [];
}

export async function listAgentToolSummariesByAgentIds(
  database: D1Database,
  agentIds: readonly AgentId[],
): Promise<Map<AgentId, AgentToolSummary[]>> {
  const uniqueAgentIds = [...new Set(agentIds)];
  const toolsByAgentId = new Map<AgentId, AgentToolSummary[]>(
    uniqueAgentIds.map((agentId) => [agentId, []]),
  );

  if (uniqueAgentIds.length === 0) {
    return toolsByAgentId;
  }

  const rows = await getAppDatabase(database)
    .select({
      agentId: agentMcpBindingsTable.agentId,
      enabled: agentMcpBindingsTable.enabled,
      iconUrl: mcpServersTable.iconUrl,
      name: mcpServersTable.name,
      serverId: mcpServersTable.id,
    })
    .from(agentMcpBindingsTable)
    .innerJoin(mcpServersTable, eq(mcpServersTable.id, agentMcpBindingsTable.serverId))
    .where(inArray(agentMcpBindingsTable.agentId, uniqueAgentIds))
    .orderBy(
      asc(agentMcpBindingsTable.agentId),
      asc(agentMcpBindingsTable.sortOrder),
      asc(agentMcpBindingsTable.createdAt),
    )
    .all();

  for (const row of rows) {
    toolsByAgentId.get(row.agentId)?.push({
      enabled: row.enabled,
      iconUrl: row.iconUrl,
      name: row.name,
      serverId: readMcpServerId(row.serverId, "MCP server ID"),
    });
  }

  return toolsByAgentId;
}
