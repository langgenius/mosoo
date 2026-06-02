import { createPackageMcpNeedsReconnectIssue } from "@mosoo/agent-package";
import type {
  AgentManifest,
  AgentManifestMcpServerBinding,
  AgentPackageResolutionSummary,
  AgentResolutionIssue,
} from "@mosoo/contracts/agent-manifest";
import { mcpServersTable } from "@mosoo/db";
import type { AccountId, McpServerId, OrganizationId } from "@mosoo/id";
import { and, eq, or } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";

interface ForkMcpServerResolution {
  packageMcpServers: AgentManifestMcpServerBinding[];
  serverIds: McpServerId[];
}

interface TargetMcpServerRow {
  authType: AgentManifestMcpServerBinding["authType"];
  credentialScope: AgentManifestMcpServerBinding["credentialScope"];
  enabled: boolean;
  id: McpServerId;
  name: string;
  source: AgentManifestMcpServerBinding["source"];
  url: string;
}

function createMcpIntentKey(
  server: Pick<TargetMcpServerRow, "authType" | "credentialScope" | "name" | "source" | "url">,
): string {
  return JSON.stringify([
    server.source,
    server.credentialScope,
    server.authType,
    server.name.trim().toLowerCase(),
    server.url.trim(),
  ]);
}

function toPackageMcpServerIntent(
  server: AgentManifestMcpServerBinding,
): AgentManifestMcpServerBinding {
  return {
    ...server,
    credentialMode: "runtime_resolved",
    serverId: null,
  };
}

export async function resolvePackageMcpServers(input: {
  issues: AgentResolutionIssue[];
  manifest: AgentManifest;
  summary: AgentPackageResolutionSummary;
}): Promise<McpServerId[]> {
  for (const server of input.manifest.mcpServers) {
    input.summary.boundMcpServerCount += 1;
    input.issues.push(
      createPackageMcpNeedsReconnectIssue({
        message: `MCP server ${server.name} was imported as an Agent-private package intent and must be connected before runtime use.`,
        serverName: server.name,
      }),
    );
  }

  return [];
}

export async function resolveForkMcpServers(input: {
  database: D1Database;
  issues: AgentResolutionIssue[];
  manifest: AgentManifest;
  organizationId: OrganizationId;
  summary: AgentPackageResolutionSummary;
  viewerId: AccountId;
}): Promise<ForkMcpServerResolution> {
  const rows = await getAppDatabase(input.database)
    .select({
      authType: mcpServersTable.authType,
      credentialScope: mcpServersTable.credentialScope,
      enabled: mcpServersTable.enabled,
      id: mcpServersTable.id,
      name: mcpServersTable.name,
      source: mcpServersTable.source,
      url: mcpServersTable.url,
    })
    .from(mcpServersTable)
    .where(
      and(
        eq(mcpServersTable.organizationId, input.organizationId),
        or(
          eq(mcpServersTable.source, "organization_shared"),
          eq(mcpServersTable.ownerId, input.viewerId),
        ),
      ),
    )
    .all();
  const rowsByIntent = new Map(
    rows.filter((row) => row.enabled).map((row) => [createMcpIntentKey(row), row]),
  );
  const packageMcpServers: AgentManifestMcpServerBinding[] = [];
  const serverIds: McpServerId[] = [];

  for (const server of input.manifest.mcpServers) {
    const row = rowsByIntent.get(createMcpIntentKey(server));

    if (!row) {
      packageMcpServers.push(toPackageMcpServerIntent(server));
      input.issues.push(
        createPackageMcpNeedsReconnectIssue({
          message: `Package-owned MCP server ${server.name} must be connected before runtime use.`,
          serverName: server.name,
        }),
      );
      input.summary.boundMcpServerCount += 1;
      continue;
    }

    if (server.credentialMode === "agent_bound") {
      input.issues.push(
        createPackageMcpNeedsReconnectIssue({
          message: `Agent-bound credential for ${server.name} was not copied.`,
          required: false,
          serverName: server.name,
          severity: "warning",
        }),
      );
    }

    serverIds.push(row.id);
    input.summary.boundMcpServerCount += 1;
    input.summary.reusedMcpServerCount += 1;
  }

  return { packageMcpServers, serverIds };
}
