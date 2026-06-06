import { describe, expect, test } from "bun:test";

import { createEmptyResolutionSummary } from "@mosoo/agent-package";
import type { AgentManifest } from "@mosoo/contracts/agent-manifest";
import { AGENT_MANIFEST_VERSION } from "@mosoo/contracts/agent-manifest";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, McpServerId, OrganizationId } from "@mosoo/id";

import {
  resolveForkMcpServers,
  resolvePackageMcpServers,
} from "../src/modules/agents/application/agent-package-mcp-resolution.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const MCP_RESOLUTION_IDS = {
  organization: parsePlatformId<OrganizationId>("01J00000000000000000000001"),
  sourceOwner: parsePlatformId<AccountId>("01J00000000000000000000002"),
  sourceServer: parsePlatformId<McpServerId>("01J00000000000000000000003"),
  targetOwner: parsePlatformId<AccountId>("01J00000000000000000000004"),
  targetServer: parsePlatformId<McpServerId>("01J00000000000000000000005"),
} as const;

function createMcpResolutionDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE mcp_server (
      auth_type text NOT NULL,
      byo_client_id text,
      byo_client_secret_secret_id text,
      created_at integer NOT NULL,
      credential_scope text NOT NULL,
      description text,
      enabled integer NOT NULL DEFAULT 1,
      icon_url text,
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      oauth_metadata_json text,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      source text NOT NULL,
      updated_at integer NOT NULL,
      url text NOT NULL
    );
  `);

  return database;
}

function createManifest(serverId: McpServerId): AgentManifest {
  return {
    advanced: null,
    environment: {
      environmentId: null,
      envVars: {},
      expectedName: null,
      setupScript: "",
    },
    kind: "pet",
    manifestVersion: AGENT_MANIFEST_VERSION,
    mcpServers: [
      {
        authType: "bearer",
        credentialMode: "runtime_resolved",
        credentialScope: "user",
        enabled: true,
        iconUrl: null,
        name: "Linear",
        serverId,
        source: "personal",
        url: "https://linear.example/mcp",
      },
    ],
    metadata: {
      description: null,
      name: "Forked Agent",
    },
    prompts: {
      system: "Help",
    },
    runtime: {
      id: "openai-runtime",
      model: "gpt-5.4",
      provider: "openai",
    },
    skills: [],
    spaces: [],
  };
}

function insertPersonalMcpServer(input: {
  database: SqliteD1Database;
  ownerId: AccountId;
  serverId: McpServerId;
}): void {
  input.database.execute(`
    INSERT INTO mcp_server (
      auth_type,
      created_at,
      credential_scope,
      description,
      enabled,
      id,
      name,
      organization_id,
      owner_account_id,
      source,
      updated_at,
      url
    )
    VALUES (
      'bearer',
      1,
      'user',
      NULL,
      1,
      '${input.serverId}',
      'Linear',
      '${MCP_RESOLUTION_IDS.organization}',
      '${input.ownerId}',
      'personal',
      1,
      'https://linear.example/mcp'
    );
  `);
}

describe("agent package MCP resolution", () => {
  test("uses the package taxonomy for import MCP reconnect issues", async () => {
    const issues: Parameters<typeof resolvePackageMcpServers>[0]["issues"] = [];
    const summary = createEmptyResolutionSummary();
    const serverIds = await resolvePackageMcpServers({
      issues,
      manifest: createManifest(MCP_RESOLUTION_IDS.sourceServer),
      summary,
    });

    expect(serverIds).toEqual([]);
    expect(issues).toMatchObject([
      {
        code: "agent.package.mcp.needs_reconnect",
        status: "needs_reconnect",
        targetLabel: "Linear",
        targetType: "mcp_server",
      },
    ]);
  });

  test("resolves fork MCP from the target viewer context instead of the source server ID", async () => {
    const database = createMcpResolutionDatabase();
    insertPersonalMcpServer({
      database,
      ownerId: MCP_RESOLUTION_IDS.sourceOwner,
      serverId: MCP_RESOLUTION_IDS.sourceServer,
    });
    insertPersonalMcpServer({
      database,
      ownerId: MCP_RESOLUTION_IDS.targetOwner,
      serverId: MCP_RESOLUTION_IDS.targetServer,
    });

    const issues: Parameters<typeof resolveForkMcpServers>[0]["issues"] = [];
    const summary = createEmptyResolutionSummary();
    const resolution = await resolveForkMcpServers({
      database,
      issues,
      manifest: createManifest(MCP_RESOLUTION_IDS.sourceServer),
      organizationId: MCP_RESOLUTION_IDS.organization,
      summary,
      viewerId: MCP_RESOLUTION_IDS.targetOwner,
    });

    expect(resolution).toEqual({
      packageMcpServers: [],
      serverIds: [MCP_RESOLUTION_IDS.targetServer],
    });
    expect(issues).toEqual([]);
    expect(summary.reusedMcpServerCount).toBe(1);
  });

  test("keeps unresolved fork MCP as a package reconnect intent with the package taxonomy", async () => {
    const database = createMcpResolutionDatabase();
    insertPersonalMcpServer({
      database,
      ownerId: MCP_RESOLUTION_IDS.sourceOwner,
      serverId: MCP_RESOLUTION_IDS.sourceServer,
    });

    const issues: Parameters<typeof resolveForkMcpServers>[0]["issues"] = [];
    const summary = createEmptyResolutionSummary();
    const resolution = await resolveForkMcpServers({
      database,
      issues,
      manifest: createManifest(MCP_RESOLUTION_IDS.sourceServer),
      organizationId: MCP_RESOLUTION_IDS.organization,
      summary,
      viewerId: MCP_RESOLUTION_IDS.targetOwner,
    });

    expect(resolution).toEqual({
      packageMcpServers: [
        {
          authType: "bearer",
          credentialMode: "runtime_resolved",
          credentialScope: "user",
          enabled: true,
          iconUrl: null,
          name: "Linear",
          serverId: null,
          source: "personal",
          url: "https://linear.example/mcp",
        },
      ],
      serverIds: [],
    });
    expect(issues).toMatchObject([
      {
        code: "agent.package.mcp.needs_reconnect",
        status: "needs_reconnect",
        targetLabel: "Linear",
        targetType: "mcp_server",
      },
    ]);
  });
});
