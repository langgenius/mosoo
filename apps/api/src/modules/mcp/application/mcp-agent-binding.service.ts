import type { AgentMcpBinding } from "@mosoo/contracts/mcp";
import { agentMcpBindingsTable } from "@mosoo/db";
import type { AgentId, AgentMcpBindingId, CredentialId, McpServerId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { forbiddenError } from "../../../platform/errors";
import { ensureAgentEditor } from "../../agents/application/agent-access.service";
import type { AgentSpecMcpBinding } from "../../agents/application/agent-spec.service";
import type { AgentRow } from "../../agents/application/agent-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureAgentCanUsePersonalServer } from "./mcp-agent-binding.policy";
import { listAgentBindingRows } from "./mcp-agent-binding.repository";
import {
  deleteCredentialArtifactsBatch,
  listCredentialsForAgentBindingDeletion,
  listCredentialsForAgentBindings,
  listServerIdsWithSharedCredentials,
} from "./mcp-credential.repository";
import { toAgentBinding } from "./mcp-mappers";
import { createAgentMcpBindingId, normalizeMcpServerIds, readAccountId } from "./mcp-platform-ids";
import { listServerRowsById } from "./mcp-server.repository";
import type { CredentialRow, ServerRow } from "./mcp-types";

export interface PreparedAgentMcpBindingRow {
  agentCredentialId: CredentialId | null;
  agentId: AgentId;
  createdAt: number;
  credentialMode: "runtime_resolved" | "agent_bound";
  enabled: boolean;
  id: AgentMcpBindingId;
  serverId: McpServerId;
  sortOrder: number;
  updatedAt: number;
}

export interface PreparedAgentMcpBindingsForConfig {
  removedCredentials: CredentialRow[];
  rows: PreparedAgentMcpBindingRow[];
  specBindings: AgentSpecMcpBinding[];
}

async function ensureConfigMcpServerAccess(input: {
  agent: AgentRow;
  database: D1Database;
  serverIds: readonly McpServerId[];
  viewer: AuthenticatedViewer;
}): Promise<Map<McpServerId, ServerRow>> {
  const serversById = await listServerRowsById(input.database, input.serverIds);
  const viewerId = readAccountId(input.viewer.id);

  for (const serverId of input.serverIds) {
    const server = serversById.get(serverId);

    if (server === undefined) {
      throw new Error(`Cannot bind MCP server ${serverId}: MCP server not found.`);
    }

    if (server.organizationId !== input.agent.organizationId) {
      throw forbiddenError("MCP server and agent profile must belong to the same organization.");
    }

    if (server.source === "personal" && server.ownerId !== viewerId) {
      throw forbiddenError("You can only bind your own personal MCP servers.");
    }

    await ensureAgentCanUsePersonalServer(input.database, input.agent, server);
  }

  return serversById;
}

export async function resolveAgentMcpServerSelectionForConfig(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: {
    agent: AgentRow;
    serverIds: readonly string[];
  },
): Promise<McpServerId[]> {
  const serverIds = normalizeMcpServerIds(input.serverIds);

  await ensureConfigMcpServerAccess({
    agent: input.agent,
    database,
    serverIds,
    viewer,
  });

  return serverIds;
}

export async function listAgentMcpBindings(
  database: D1Database,
  viewer: AuthenticatedViewer,
  agentId: AgentId,
): Promise<AgentMcpBinding[]> {
  const viewerId = readAccountId(viewer.id);
  const { agent } = await ensureAgentEditor(database, viewerId, agentId);
  const rows = await listAgentBindingRows(database, agent.id);
  const [credentialsByBindingId, sharedCredentialServerIds] = await Promise.all([
    listCredentialsForAgentBindings(database, rows, viewerId),
    listServerIdsWithSharedCredentials(
      database,
      rows.map((row) => row.serverId),
    ),
  ]);

  return rows.map((row) =>
    toAgentBinding(
      row,
      credentialsByBindingId.get(row.id) ?? null,
      sharedCredentialServerIds.has(row.serverId),
    ),
  );
}

export async function listAgentMcpServerIds(
  database: D1Database,
  agentId: AgentId,
): Promise<McpServerId[]> {
  const rows = await listAgentBindingRows(database, agentId);

  return rows.map((row) => row.serverId);
}

export async function replaceAgentMcpBindingsForConfig(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: {
    agent: AgentRow;
    serverIds: readonly string[];
    updatedAt: number;
  },
): Promise<void> {
  const prepared = await prepareAgentMcpBindingsForConfig(database, viewer, input);
  await deleteCredentialArtifactsBatch(database, prepared.removedCredentials);
  await getAppDatabase(database)
    .delete(agentMcpBindingsTable)
    .where(eq(agentMcpBindingsTable.agentId, input.agent.id))
    .run();

  if (prepared.rows.length > 0) {
    await getAppDatabase(database).insert(agentMcpBindingsTable).values(prepared.rows).run();
  }
}

function readBoolean(value: boolean | number | string): boolean {
  return value === true || value === 1 || value === "1";
}

export async function prepareAgentMcpBindingsForConfig(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: {
    agent: AgentRow;
    serverIds: readonly string[];
    updatedAt: number;
  },
): Promise<PreparedAgentMcpBindingsForConfig> {
  const serverIds = normalizeMcpServerIds(input.serverIds);
  const serversById = await ensureConfigMcpServerAccess({
    agent: input.agent,
    database,
    serverIds,
    viewer,
  });
  const existingRows = await getAppDatabase(database)
    .select({
      agentCredentialId: agentMcpBindingsTable.agentCredentialId,
      agentId: agentMcpBindingsTable.agentId,
      createdAt: agentMcpBindingsTable.createdAt,
      credentialMode: agentMcpBindingsTable.credentialMode,
      enabled: agentMcpBindingsTable.enabled,
      id: agentMcpBindingsTable.id,
      serverId: agentMcpBindingsTable.serverId,
      sortOrder: agentMcpBindingsTable.sortOrder,
      updatedAt: agentMcpBindingsTable.updatedAt,
    })
    .from(agentMcpBindingsTable)
    .where(eq(agentMcpBindingsTable.agentId, input.agent.id))
    .all();
  const existingByServerId = new Map(existingRows.map((row) => [row.serverId, row]));
  const nextServerIdSet = new Set(serverIds);
  const removedRows = existingRows.filter((row) => !nextServerIdSet.has(row.serverId));
  const removedCredentials = await listCredentialsForAgentBindingDeletion(database, {
    agentId: input.agent.id,
    bindings: removedRows,
  });

  const nextRows = serverIds.map((serverId, sortOrder) => {
    const existing = existingByServerId.get(serverId);

    return {
      agentCredentialId: existing?.agentCredentialId ?? null,
      agentId: input.agent.id,
      createdAt: existing?.createdAt ?? input.updatedAt,
      credentialMode: existing?.credentialMode ?? "runtime_resolved",
      enabled: existing === undefined ? true : readBoolean(existing.enabled),
      id: existing?.id ?? createAgentMcpBindingId(),
      serverId,
      sortOrder,
      updatedAt: input.updatedAt,
    };
  });

  return {
    removedCredentials,
    rows: nextRows,
    specBindings: nextRows.map((row): AgentSpecMcpBinding => {
      const server = serversById.get(row.serverId);

      if (!server) {
        throw new Error(`Cannot bind MCP server ${row.serverId}: MCP server not found.`);
      }

      return {
        agentCredentialId: row.agentCredentialId,
        authType: server.authType,
        credentialMode: row.credentialMode,
        credentialScope: server.credentialScope,
        enabled: readBoolean(row.enabled),
        iconUrl: server.iconUrl,
        name: server.name,
        serverId: row.serverId,
        sortOrder: row.sortOrder,
        source: server.source,
        url: server.url,
      };
    }),
  };
}

export async function deletePreparedAgentMcpBindingCredentials(
  database: D1Database,
  prepared: PreparedAgentMcpBindingsForConfig,
): Promise<void> {
  await deleteCredentialArtifactsBatch(database, prepared.removedCredentials);
}

export async function removeAllAgentMcpBindings(
  database: D1Database,
  agentId: AgentId,
): Promise<{ bindingIds: AgentMcpBindingId[]; credentialIds: CredentialId[] }> {
  const results = await getAppDatabase(database)
    .select({
      agentCredentialId: agentMcpBindingsTable.agentCredentialId,
      id: agentMcpBindingsTable.id,
      serverId: agentMcpBindingsTable.serverId,
    })
    .from(agentMcpBindingsTable)
    .where(eq(agentMcpBindingsTable.agentId, agentId))
    .all();
  const credentials = await listCredentialsForAgentBindingDeletion(database, {
    agentId,
    bindings: results,
  });
  await deleteCredentialArtifactsBatch(database, credentials);

  await getAppDatabase(database)
    .delete(agentMcpBindingsTable)
    .where(eq(agentMcpBindingsTable.agentId, agentId))
    .run();

  return {
    bindingIds: results.map((row) => row.id),
    credentialIds: results
      .map((row) => row.agentCredentialId)
      .filter((credentialId): credentialId is CredentialId => credentialId !== null),
  };
}
