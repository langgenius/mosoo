import { createPackageMcpNeedsReconnectIssue } from "@mosoo/agent-package";
import type {
  AgentManifest,
  AgentManifestMcpServerBinding,
  AgentPackageResolutionSummary,
  AgentResolutionIssue,
} from "@mosoo/contracts/agent-manifest";
import type { McpServerId } from "@mosoo/id";

interface ForkMcpServerResolution {
  packageMcpServers: AgentManifestMcpServerBinding[];
  serverIds: McpServerId[];
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

function recordReconnectRequired(input: {
  issues: AgentResolutionIssue[];
  server: AgentManifestMcpServerBinding;
  summary: AgentPackageResolutionSummary;
}): AgentManifestMcpServerBinding {
  input.summary.boundMcpServerCount += 1;
  input.issues.push(
    createPackageMcpNeedsReconnectIssue({
      message: `MCP server ${input.server.name} must be connected inside the target App before runtime use.`,
      serverName: input.server.name,
    }),
  );
  return toPackageMcpServerIntent(input.server);
}

export async function resolvePackageMcpServers(input: {
  issues: AgentResolutionIssue[];
  manifest: AgentManifest;
  summary: AgentPackageResolutionSummary;
}): Promise<McpServerId[]> {
  for (const server of input.manifest.mcpServers) {
    recordReconnectRequired({
      issues: input.issues,
      server,
      summary: input.summary,
    });
  }

  return [];
}

export async function resolveForkMcpServers(input: {
  issues: AgentResolutionIssue[];
  manifest: AgentManifest;
  summary: AgentPackageResolutionSummary;
}): Promise<ForkMcpServerResolution> {
  const packageMcpServers = input.manifest.mcpServers.map((server) =>
    recordReconnectRequired({
      issues: input.issues,
      server,
      summary: input.summary,
    }),
  );

  return { packageMcpServers, serverIds: [] };
}
