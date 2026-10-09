import type { AgentMcpBinding } from "@mosoo/contracts/mcp";
import { agentMcpBindingsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { AgentId, AgentMcpBindingId, CredentialId, McpServerId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { forbiddenError } from "../../../platform/errors";
import { ensureAgentEditor } from "../../agents/application/agent-access.service";
import type { AgentSpecMcpBinding } from "../../agents/application/agent-spec.service";
import type { AgentRow } from "../../agents/application/agent-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { listAgentBindingRows } from "./mcp-agent-binding.repository";
import { listProjectCredentialRowsByServerId } from "./mcp-credential.repository";
import { toAgentBinding } from "./mcp-mappers";
import { listServerRowsById } from "./mcp-server.repository";

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
  rows: PreparedAgentMcpBindingRow[];
  specBindings: AgentSpecMcpBinding[];
}

export async function listAgentMcpBindings(
  database: D1Database,
  viewer: AuthenticatedViewer,
  agentId: AgentId,
): Promise<AgentMcpBinding[]> {
  const agent = await ensureAgentEditor(database, viewer.id, agentId);
  const rows = await listAgentBindingRows(database, agent.id);
  const credentialsByServerId = await listProjectCredentialRowsByServerId(
    database,
    rows.map((row) => row.serverId),
  );

  return rows.map((row) => toAgentBinding(row, credentialsByServerId.get(row.serverId) ?? null));
}

export async function listAgentMcpServerIds(
  database: D1Database,
  agentId: AgentId,
): Promise<McpServerId[]> {
  const rows = await listAgentBindingRows(database, agentId);

  return rows.map((row) => row.serverId);
}

export async function prepareAgentMcpBindingsForConfig(
  database: D1Database,
  input: {
    agent: AgentRow;
    serverIds: readonly McpServerId[];
    updatedAt: number;
  },
): Promise<PreparedAgentMcpBindingsForConfig> {
  const serverIds = [...new Set(input.serverIds)];
  const serversById = await listServerRowsById(database, serverIds);
  const existingRows = await getAppDatabase(database)
    .select({
      agentCredentialId: agentMcpBindingsTable.agentCredentialId,
      createdAt: agentMcpBindingsTable.createdAt,
      credentialMode: agentMcpBindingsTable.credentialMode,
      enabled: agentMcpBindingsTable.enabled,
      id: agentMcpBindingsTable.id,
      serverId: agentMcpBindingsTable.serverId,
    })
    .from(agentMcpBindingsTable)
    .where(eq(agentMcpBindingsTable.agentId, input.agent.id))
    .all();
  const existingByServerId = new Map(existingRows.map((row) => [row.serverId, row]));
  const rows: PreparedAgentMcpBindingRow[] = [];
  const specBindings: AgentSpecMcpBinding[] = [];

  for (const [sortOrder, serverId] of serverIds.entries()) {
    const server = serversById.get(serverId);

    if (server === undefined) {
      throw new Error(`Cannot bind MCP server ${serverId}: MCP server not found.`);
    }

    if (server.projectId !== input.agent.projectId) {
      throw forbiddenError("MCP server and agent profile must belong to the same project.");
    }

    const existing = existingByServerId.get(serverId);
    const row: PreparedAgentMcpBindingRow = {
      agentCredentialId: existing?.agentCredentialId ?? null,
      agentId: input.agent.id,
      createdAt: existing?.createdAt ?? input.updatedAt,
      credentialMode: existing?.credentialMode ?? "runtime_resolved",
      enabled: existing?.enabled ?? true,
      id: existing?.id ?? createPlatformId<AgentMcpBindingId>(),
      serverId,
      sortOrder,
      updatedAt: input.updatedAt,
    };

    rows.push(row);
    specBindings.push({
      agentCredentialId: row.agentCredentialId,
      authType: server.authType,
      credentialMode: row.credentialMode,
      credentialScope: server.credentialScope,
      enabled: row.enabled,
      iconUrl: server.iconUrl,
      name: server.name,
      serverId,
      sortOrder,
      source: server.source,
      url: server.url,
    });
  }

  return { rows, specBindings };
}

export async function removeAllAgentMcpBindings(
  database: D1Database,
  agentId: AgentId,
): Promise<void> {
  await getAppDatabase(database)
    .delete(agentMcpBindingsTable)
    .where(eq(agentMcpBindingsTable.agentId, agentId))
    .run();
}
