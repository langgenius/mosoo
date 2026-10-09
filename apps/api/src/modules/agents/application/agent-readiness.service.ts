import type {
  AgentBuiltInToolConfig,
  AgentEnvironmentConfig,
  AgentReadiness,
  AgentReadinessIssue,
} from "@mosoo/contracts/agent";
import { getAgentBuiltInToolSupportError } from "@mosoo/contracts/agent";
import type { AgentPackageResolutionState } from "@mosoo/contracts/agent-manifest";
import {
  agentMcpBindingsTable,
  environmentRevisionsTable,
  environmentsTable,
  mcpServersTable,
} from "@mosoo/db";
import type { AgentId, EnvironmentId, McpServerId, ProjectId } from "@mosoo/id";
import { and, eq, inArray } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { toIsoString } from "../../../time";
import { parseStoredEnvVarsJson } from "../../environments/application/environment-config";
import type { StoredEnvironmentVariable } from "../../environments/application/environment-types";
import { collectRuntimeCapabilityIssues } from "./agent-runtime-capability-resolution.service";

function createIssue(
  code: AgentReadinessIssue["code"],
  message: string,
  severity: AgentReadinessIssue["severity"] = "error",
): AgentReadinessIssue {
  return {
    code,
    message,
    severity,
  };
}

async function collectMcpIssues(
  database: D1Database,
  agentId: AgentId | null,
  snapshotServerIds?: readonly McpServerId[],
): Promise<AgentReadinessIssue[]> {
  if (snapshotServerIds) {
    if (snapshotServerIds.length === 0) {
      return [];
    }

    const requestedServerIds = [...new Set(snapshotServerIds)];
    const servers = await getAppDatabase(database)
      .select({
        enabled: mcpServersTable.enabled,
        id: mcpServersTable.id,
        name: mcpServersTable.name,
      })
      .from(mcpServersTable)
      .where(inArray(mcpServersTable.id, requestedServerIds))
      .all();
    const resolvedIds = new Set(servers.map((server) => server.id));

    return [
      ...requestedServerIds
        .filter((serverId) => !resolvedIds.has(serverId))
        .map((serverId) =>
          createIssue(
            "agent.mcp.invalid",
            `MCP binding ${serverId} is enabled on the session snapshot, but the server no longer exists.`,
          ),
        ),
      ...servers
        .filter((server) => !server.enabled)
        .map((server) =>
          createIssue(
            "agent.mcp.invalid",
            `MCP binding ${server.name} is enabled on the session snapshot, but the server is disabled.`,
          ),
        ),
    ];
  }

  if (agentId === null) return [];

  const disabledServers = await getAppDatabase(database)
    .select({ serverName: mcpServersTable.name })
    .from(agentMcpBindingsTable)
    .innerJoin(mcpServersTable, eq(mcpServersTable.id, agentMcpBindingsTable.serverId))
    .where(
      and(
        eq(agentMcpBindingsTable.agentId, agentId),
        eq(agentMcpBindingsTable.enabled, true),
        eq(mcpServersTable.enabled, false),
      ),
    )
    .all();

  return disabledServers.map((server) =>
    createIssue(
      "agent.mcp.invalid",
      `MCP binding ${server.serverName} is enabled on the agent, but the server is disabled.`,
    ),
  );
}

async function listBoundMcpServerNames(
  database: D1Database,
  agentId: AgentId | null,
  snapshotServerIds?: readonly McpServerId[],
): Promise<Set<string>> {
  if (snapshotServerIds !== undefined) {
    if (snapshotServerIds.length === 0) return new Set();
    const rows = await getAppDatabase(database)
      .select({ serverName: mcpServersTable.name })
      .from(mcpServersTable)
      .where(
        and(inArray(mcpServersTable.id, [...snapshotServerIds]), eq(mcpServersTable.enabled, true)),
      )
      .all();
    return new Set(rows.map((row) => row.serverName.toLowerCase()));
  }
  if (agentId === null) return new Set();
  const results = await getAppDatabase(database)
    .select({ serverName: mcpServersTable.name })
    .from(agentMcpBindingsTable)
    .innerJoin(mcpServersTable, eq(mcpServersTable.id, agentMcpBindingsTable.serverId))
    .where(
      and(
        eq(agentMcpBindingsTable.agentId, agentId),
        eq(agentMcpBindingsTable.enabled, true),
        eq(mcpServersTable.enabled, true),
      ),
    )
    .all();

  return new Set(results.map((row) => row.serverName.toLowerCase()));
}

async function listEnvironmentVariables(
  database: D1Database,
  environmentId: EnvironmentId | null,
): Promise<StoredEnvironmentVariable[]> {
  if (!environmentId) {
    return [];
  }

  const row = await getAppDatabase(database)
    .select({ envVarsJson: environmentRevisionsTable.envVarsJson })
    .from(environmentsTable)
    .innerJoin(
      environmentRevisionsTable,
      eq(environmentRevisionsTable.id, environmentsTable.currentRevisionId),
    )
    .where(eq(environmentsTable.id, environmentId))
    .limit(1)
    .get();

  return row ? parseStoredEnvVarsJson(row.envVarsJson) : [];
}

async function collectPackageResolutionIssues(
  database: D1Database,
  input: {
    agentId: AgentId | null;
    mcpServerIds?: readonly McpServerId[];
    environment: AgentEnvironmentConfig;
    environmentSecretNames: Set<string>;
    packageResolution: AgentPackageResolutionState | null | undefined;
  },
): Promise<AgentReadinessIssue[]> {
  if (!input.packageResolution) {
    return [];
  }

  const packageIssues = input.packageResolution.report.issues;
  const needsMcpNames = packageIssues.some(
    (issue) =>
      issue.targetType === "mcp_server" &&
      (issue.status === "missing" || issue.status === "needs_reconnect"),
  );
  const boundMcpServerNames = needsMcpNames
    ? await listBoundMcpServerNames(database, input.agentId, input.mcpServerIds)
    : new Set<string>();
  const issues: AgentReadinessIssue[] = [];

  for (const issue of packageIssues) {
    if (
      !issue.required ||
      issue.severity !== "error" ||
      issue.status === "resolved" ||
      issue.status === "warning"
    ) {
      continue;
    }

    if (
      issue.targetType === "environment" &&
      issue.code.includes("environment_secret") &&
      issue.targetLabel !== null &&
      input.environmentSecretNames.has(issue.targetLabel)
    ) {
      continue;
    }

    if (
      issue.targetType === "environment" &&
      !issue.code.includes("environment_secret") &&
      input.environment.environmentId !== null &&
      input.environment.environmentId !== ""
    ) {
      continue;
    }

    if (
      issue.targetType === "mcp_server" &&
      issue.targetLabel !== null &&
      boundMcpServerNames.has(issue.targetLabel.toLowerCase())
    ) {
      continue;
    }

    if (
      issue.targetType === "runtime" ||
      issue.targetType === "provider" ||
      issue.targetType === "model"
    ) {
      continue;
    }

    issues.push(
      createIssue(
        `agent.package_resolution.${issue.code}`,
        `Package import item unresolved: ${issue.message}`,
      ),
    );
  }

  return issues;
}

export function formatAgentReadinessFailureMessage(
  prefix: string,
  readiness: Pick<AgentReadiness, "issues">,
): string {
  const blockingIssues = readiness.issues.filter((issue) => issue.severity === "error");
  const issues = blockingIssues.length > 0 ? blockingIssues : readiness.issues;
  const message = issues.map((issue) => issue.message).join(" ");

  return message.length === 0 ? prefix : `${prefix}: ${message}`;
}

export async function computeAgentReadiness(
  database: D1Database,
  input: {
    agentId: AgentId | null;
    builtInTools: readonly AgentBuiltInToolConfig[];
    environment: AgentEnvironmentConfig;
    model: string;
    packageResolution?: AgentPackageResolutionState | null;
    mcpServerIds?: readonly McpServerId[];
    projectId: ProjectId;
    provider: string;
    runtimeId: string;
  },
): Promise<AgentReadiness> {
  const toolSupportError = getAgentBuiltInToolSupportError(input.runtimeId, input.builtInTools);
  if (toolSupportError !== null) {
    return {
      checkedAt: toIsoString(Date.now()),
      issues: [createIssue("agent.runtime.tool_restrictions_unsupported", toolSupportError)],
      ready: false,
    };
  }

  const capabilityIssues = await collectRuntimeCapabilityIssues({
    codePrefix: "agent.readiness",
    database,
    projectId: input.projectId,
    selection: {
      model: input.model,
      provider: input.provider,
      runtimeId: input.runtimeId,
    },
  });
  const environmentVariables = await listEnvironmentVariables(
    database,
    input.environment.environmentId,
  );
  const issues: AgentReadinessIssue[] = [
    ...capabilityIssues.map((issue) =>
      createIssue(
        `agent.capability.${issue.code}`,
        issue.message,
        issue.severity === "error" ? "error" : "warning",
      ),
    ),
    ...(await collectPackageResolutionIssues(database, {
      agentId: input.agentId,
      ...(input.mcpServerIds === undefined ? {} : { mcpServerIds: input.mcpServerIds }),
      environment: input.environment,
      environmentSecretNames: new Set(
        environmentVariables
          .filter((envVar) => envVar.secretId !== null)
          .map((envVar) => envVar.key),
      ),
      packageResolution: input.packageResolution,
    })),
    ...environmentVariables
      .filter((envVar) => envVar.secretId === null)
      .map((envVar) =>
        createIssue(
          "agent.environment_secret.pending",
          `Environment variable ${envVar.key} must be configured before this Agent can run.`,
        ),
      ),
    ...(await collectMcpIssues(database, input.agentId, input.mcpServerIds)),
  ];

  return {
    checkedAt: toIsoString(Date.now()),
    issues,
    ready: issues.every((issue) => issue.severity !== "error"),
  };
}
