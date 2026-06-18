import { describe, expect, test } from "bun:test";

import { createEmptyResolutionSummary } from "@mosoo/agent-package";
import type { AgentManifest } from "@mosoo/contracts/agent-manifest";
import { AGENT_MANIFEST_VERSION } from "@mosoo/contracts/agent-manifest";
import { parsePlatformId } from "@mosoo/id";
import type { McpServerId } from "@mosoo/id";

import {
  resolveForkMcpServers,
  resolvePackageMcpServers,
} from "../src/modules/agents/application/agent-package-mcp-resolution.service";

const MCP_RESOLUTION_IDS = {
  sourceServer: parsePlatformId<McpServerId>("01J00000000000000000000003"),
} as const;

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
        credentialScope: "app",
        enabled: true,
        iconUrl: null,
        name: "Linear",
        serverId,
        source: "app",
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
      providerOptions: {},
    },
    skills: [],
  };
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

  test("keeps fork MCP as a package reconnect intent even when source server IDs exist", async () => {
    const issues: Parameters<typeof resolveForkMcpServers>[0]["issues"] = [];
    const summary = createEmptyResolutionSummary();
    const resolution = await resolveForkMcpServers({
      issues,
      manifest: createManifest(MCP_RESOLUTION_IDS.sourceServer),
      summary,
    });

    expect(resolution).toEqual({
      packageMcpServers: [
        {
          authType: "bearer",
          credentialMode: "runtime_resolved",
          credentialScope: "app",
          enabled: true,
          iconUrl: null,
          name: "Linear",
          serverId: null,
          source: "app",
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
