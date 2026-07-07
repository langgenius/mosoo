import type { AgentOwnerSummary, AgentToolSummary, AgentVisibility } from "@mosoo/contracts/agent";
import {
  accountsTable,
  agentMcpBindingsTable,
  agentSkillsTable,
  agentsTable,
  appsTable,
  mcpServersTable,
} from "@mosoo/db";
import type {
  AccountId,
  AgentDeploymentVersionId,
  AgentId,
  EnvironmentId,
  AppId,
  SkillId,
} from "@mosoo/id";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { notFoundError } from "../../../platform/errors";
import {
  readAccountId,
  readAgentDeploymentVersionId,
  readAgentId,
  readEnvironmentId,
  readMcpServerId,
  readAppId,
} from "./agent-platform-ids";
import { normalizeAgentSkillIds } from "./agent-skill-resolution.service";
import { normalizeAgentStoredConfigJson } from "./agent-stored-config.service";
import type { AgentRow } from "./agent-types";

const agentRowColumns = {
  configJson: agentsTable.configJson,
  createdAt: agentsTable.createdAt,
  description: agentsTable.description,
  environmentId: agentsTable.environmentId,
  id: agentsTable.id,
  kind: agentsTable.kind,
  liveDeploymentVersionId: agentsTable.liveDeploymentVersionId,
  model: agentsTable.model,
  name: agentsTable.name,
  ownerId: agentsTable.ownerId,
  appId: agentsTable.appId,
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
  ownerId: AccountId;
  appId: AppId;
  prompt: string;
  provider: string;
  runtimeId: string;
  status: AgentRow["status"];
  updatedAt: number;
  visibility: string;
};

function readAgentVisibility(value: string): AgentVisibility {
  if (value === "private") {
    return value;
  }

  throw new Error("Agent visibility must be private for App-scoped Agents.");
}

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
    ownerId: readAccountId(row.ownerId, "Agent owner ID"),
    appId: readAppId(row.appId, "Agent app ID"),
    visibility: readAgentVisibility(row.visibility),
  };
}

export async function getAgentRow(database: D1Database, agentId: string): Promise<AgentRow> {
  const normalizedAgentId = readAgentId(agentId);
  const row = await getAppDatabase(database)
    .select(agentRowColumns)
    .from(agentsTable)
    .innerJoin(appsTable, eq(appsTable.id, agentsTable.appId))
    .where(eq(agentsTable.id, normalizedAgentId))
    .limit(1)
    .get();

  if (!row) {
    throw notFoundError("Agent not found.");
  }

  return toAgentRow(row);
}

export async function getAppAgentRow(
  database: D1Database,
  input: {
    agentId: AgentId;
    appId: AppId;
  },
): Promise<AgentRow | null> {
  const row =
    (await getAppDatabase(database)
      .select(agentRowColumns)
      .from(agentsTable)
      .innerJoin(appsTable, eq(appsTable.id, agentsTable.appId))
      .where(and(eq(agentsTable.id, input.agentId), eq(agentsTable.appId, input.appId)))
      .limit(1)
      .get()) ?? null;

  return row === null ? null : toAgentRow(row);
}

/**
 * Name-addressed API namespace lookup (PRD "API Namespace & Access"): the
 * routable rows for (App, name) are exactly the published Agents whose repo
 * deploy exposed them (`exposedViaApi = 1`; NULL console rows and 0 internal
 * rows never match). Callers must treat anything but a single row as
 * publicNotFound — zero rows means not routable, and two rows are legacy
 * duplicate names the service level refuses to guess between (no
 * (app_id, name) unique index in v1; the native upsert blocks duplicates on
 * protocol Apps).
 */
export async function listExposedAgentApiEndpointRowsByName(
  database: D1Database,
  input: {
    appId: AppId;
    name: string;
  },
): Promise<AgentRow[]> {
  const rows = await getAppDatabase(database)
    .select(agentRowColumns)
    .from(agentsTable)
    .where(
      and(
        eq(agentsTable.appId, input.appId),
        eq(agentsTable.name, input.name),
        eq(agentsTable.exposedViaApi, 1),
        eq(agentsTable.status, "published"),
      ),
    )
    .limit(2)
    .all();

  return rows.map(toAgentRow);
}

/**
 * Distinct exposed+published Agent names for an App's namespace OpenAPI
 * document, in stable name order. Duplicate names collapse to one entry;
 * the thread routes still refuse them as ambiguous until a dedupe backfill
 * allows the unique index.
 */
export async function listExposedAgentApiNames(
  database: D1Database,
  appId: AppId,
): Promise<string[]> {
  const rows = await getAppDatabase(database)
    .selectDistinct({ name: agentsTable.name })
    .from(agentsTable)
    .where(
      and(
        eq(agentsTable.appId, appId),
        eq(agentsTable.exposedViaApi, 1),
        eq(agentsTable.status, "published"),
      ),
    )
    .orderBy(asc(agentsTable.name))
    .all();

  return rows.map((row) => row.name);
}

export async function listAppOwnerAgentRows(
  database: D1Database,
  input: {
    appId: AppId;
    viewerId: AccountId;
  },
): Promise<AgentRow[]> {
  const rows = await getAppDatabase(database)
    .select(agentRowColumns)
    .from(agentsTable)
    .innerJoin(appsTable, eq(appsTable.id, agentsTable.appId))
    .where(and(eq(agentsTable.appId, input.appId), eq(agentsTable.ownerId, input.viewerId)))
    .orderBy(desc(agentsTable.updatedAt))
    .all();

  return rows.map(toAgentRow);
}

export async function listAppOwnerAgentRowsPage(
  database: D1Database,
  input: {
    appId: AppId;
    limit: number;
    viewerId: AccountId;
  },
): Promise<AgentRow[]> {
  const rows = await getAppDatabase(database)
    .select(agentRowColumns)
    .from(agentsTable)
    .innerJoin(appsTable, eq(appsTable.id, agentsTable.appId))
    .where(and(eq(agentsTable.appId, input.appId), eq(agentsTable.ownerId, input.viewerId)))
    .orderBy(desc(agentsTable.updatedAt), asc(agentsTable.id))
    .limit(input.limit)
    .all();

  return rows.map(toAgentRow);
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
