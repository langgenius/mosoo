import type {
  AgentEnvironmentConfig,
  AgentReadiness,
  AgentReadinessIssue,
} from "@mosoo/contracts/agent";
import type {
  AgentPackageResolutionState,
  AgentResolutionIssue,
} from "@mosoo/contracts/agent-manifest";
import {
  agentMcpBindingsTable,
  environmentRevisionsTable,
  environmentsTable,
  mcpServersTable,
} from "@mosoo/db";
import type { AccountId, AgentId, EnvironmentId, McpServerId, OrganizationId } from "@mosoo/id";
import { and, eq, inArray, sql } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { toIsoString } from "../../../time";
import { parseStoredEnvVarsJson } from "../../environments/application/environment-config";
import { getSupportedRuntimeId } from "../../runtime/domain/runtime-config";
import {
  isSpaceRoleRankSufficient,
  listSpaceAccessRows,
} from "../../spaces/domain/space-access.policy";
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

function isSqliteEnabled(value: boolean | number | string): boolean {
  return value === true || value === 1 || value === "1";
}

async function collectBoundSpaceIssues(
  database: D1Database,
  permissionPrincipalUserId: AccountId,
  environment: AgentEnvironmentConfig,
): Promise<AgentReadinessIssue[]> {
  const issues: AgentReadinessIssue[] = [];
  const boundSpaceIds = [...new Set(environment.boundSpaceIds)];
  const access = await listSpaceAccessRows(database, permissionPrincipalUserId, boundSpaceIds);

  for (const spaceId of boundSpaceIds) {
    const row = access.accessibleRowsById.get(spaceId);

    if (!access.existingSpaceIds.has(spaceId)) {
      issues.push(
        createIssue(
          "agent.bound_space.missing",
          `Bound Space ${spaceId} is not available: Space not found.`,
        ),
      );
      continue;
    }

    if (!row || !isSpaceRoleRankSufficient(row.role_rank, "read")) {
      issues.push(
        createIssue(
          "agent.bound_space.forbidden",
          `Bound Space ${spaceId} is not available: Insufficient space permission.`,
        ),
      );
    }
  }

  return issues;
}

async function collectMcpIssues(
  database: D1Database,
  agentId: AgentId,
  snapshotServerIds?: readonly McpServerId[],
): Promise<AgentReadinessIssue[]> {
  if (snapshotServerIds) {
    if (snapshotServerIds.length === 0) {
      return [];
    }

    const requestedServerIds = [...new Set(snapshotServerIds)];
    const results = await getAppDatabase(database)
      .select({
        id: sql<string>`${mcpServersTable.id}`.as("id"),
        serverEnabled: sql<boolean | number | string>`${mcpServersTable.enabled}`.as(
          "serverEnabled",
        ),
        serverName: sql<string>`${mcpServersTable.name}`.as("serverName"),
      })
      .from(mcpServersTable)
      .where(inArray(mcpServersTable.id, requestedServerIds))
      .all();

    const resolvedIds = new Set(results.map((row) => row.id));
    const missingIssues = requestedServerIds
      .filter((serverId) => !resolvedIds.has(serverId))
      .map((serverId) =>
        createIssue(
          "agent.mcp.invalid",
          `MCP binding ${serverId} is enabled on the session snapshot, but the server no longer exists.`,
        ),
      );

    return [
      ...missingIssues,
      ...results.flatMap((row) => {
        if (isSqliteEnabled(row.serverEnabled)) {
          return [];
        }

        return [
          createIssue(
            "agent.mcp.invalid",
            `MCP binding ${row.serverName} is enabled on the session snapshot, but the server is disabled.`,
          ),
        ];
      }),
    ];
  }

  const results = await getAppDatabase(database)
    .select({
      bindingEnabled: sql<boolean | number | string>`${agentMcpBindingsTable.enabled}`.as(
        "bindingEnabled",
      ),
      serverEnabled: sql<boolean | number | string>`${mcpServersTable.enabled}`.as("serverEnabled"),
      serverName: sql<string>`${mcpServersTable.name}`.as("serverName"),
    })
    .from(agentMcpBindingsTable)
    .innerJoin(mcpServersTable, eq(mcpServersTable.id, agentMcpBindingsTable.serverId))
    .where(eq(agentMcpBindingsTable.agentId, agentId))
    .all();

  return results.flatMap((row) => {
    if (!isSqliteEnabled(row.bindingEnabled)) {
      return [];
    }

    if (!isSqliteEnabled(row.serverEnabled)) {
      return [
        createIssue(
          "agent.mcp.invalid",
          `MCP binding ${row.serverName} is enabled on the agent, but the server is disabled.`,
        ),
      ];
    }

    return [];
  });
}

async function listBoundMcpServerNames(
  database: D1Database,
  agentId: AgentId,
): Promise<Set<string>> {
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

function isFilledEnvironmentValue(
  environmentSecretNames: Set<string>,
  key: string | null,
): boolean {
  if (key === null) {
    return false;
  }

  return environmentSecretNames.has(key);
}

async function listEnvironmentSecretNames(
  database: D1Database,
  environmentId: EnvironmentId | null,
): Promise<Set<string>> {
  if (environmentId === null || environmentId === "") {
    return new Set();
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

  if (!row) {
    return new Set();
  }

  return new Set(
    parseStoredEnvVarsJson(row.envVarsJson)
      .filter((envVar) => envVar.secretId !== null)
      .map((envVar) => envVar.key),
  );
}

async function collectPendingEnvironmentSecretIssues(
  database: D1Database,
  environmentId: EnvironmentId | null,
): Promise<AgentReadinessIssue[]> {
  if (environmentId === null || environmentId === "") {
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

  if (!row) {
    return [];
  }

  return parseStoredEnvVarsJson(row.envVarsJson)
    .filter((envVar) => envVar.secretId === null)
    .map((envVar) =>
      createIssue(
        "agent.environment_secret.pending",
        `Environment variable ${envVar.key} must be configured before this Agent can run.`,
      ),
    );
}

async function collectPackageResolutionIssues(
  database: D1Database,
  input: {
    agentId: AgentId;
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
    ? await listBoundMcpServerNames(database, input.agentId)
    : new Set<string>();
  let availableSpaceRepairCount = input.environment.boundSpaceIds.length;
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
      isFilledEnvironmentValue(input.environmentSecretNames, issue.targetLabel)
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

    if (issue.targetType === "space" && availableSpaceRepairCount > 0) {
      availableSpaceRepairCount -= 1;
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

function toReadinessIssue(issue: AgentResolutionIssue): AgentReadinessIssue {
  return createIssue(
    `agent.capability.${issue.code}`,
    issue.actionLabel === undefined || issue.actionLabel === ""
      ? issue.message
      : `${issue.message} Next: ${issue.actionLabel}.`,
    issue.severity === "error" ? "error" : "warning",
  );
}

function dedupeReadinessIssues(issues: AgentReadinessIssue[]): AgentReadinessIssue[] {
  const seen = new Set<string>();
  const deduped: AgentReadinessIssue[] = [];

  for (const issue of issues) {
    const key = `${issue.code}:${issue.message}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(issue);
  }

  return deduped;
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
  permissionPrincipalUserId: AccountId,
  input: {
    agentId: AgentId;
    environment: AgentEnvironmentConfig;
    model: string;
    organizationId: OrganizationId;
    packageResolution?: AgentPackageResolutionState | null;
    bindings?: ApiBindings;
    mcpServerIds?: readonly McpServerId[];
    provider: string;
    runtimeId: string;
  },
): Promise<AgentReadiness> {
  const issues: AgentReadinessIssue[] = [];

  if (getSupportedRuntimeId(input.runtimeId) === null) {
    issues.push(
      createIssue(
        "agent.runtime.unsupported",
        `Runtime ${input.runtimeId} is not supported by the current driver stack.`,
      ),
    );
  }

  const capabilityIssues = await collectRuntimeCapabilityIssues({
    actorAccountId: permissionPrincipalUserId,
    ...(input.bindings === undefined ? {} : { bindings: input.bindings }),
    codePrefix: "agent.readiness",
    database,
    organizationId: input.organizationId,
    selection: {
      model: input.model,
      provider: input.provider,
      runtimeId: input.runtimeId,
    },
  });
  issues.push(...capabilityIssues.map((issue) => toReadinessIssue(issue)));
  issues.push(
    ...(await collectPackageResolutionIssues(database, {
      agentId: input.agentId,
      environment: input.environment,
      environmentSecretNames: await listEnvironmentSecretNames(
        database,
        input.environment.environmentId,
      ),
      packageResolution: input.packageResolution,
    })),
  );
  issues.push(
    ...(await collectPendingEnvironmentSecretIssues(database, input.environment.environmentId)),
  );
  issues.push(
    ...(await collectBoundSpaceIssues(database, permissionPrincipalUserId, input.environment)),
  );
  issues.push(...(await collectMcpIssues(database, input.agentId, input.mcpServerIds)));
  const dedupedIssues = dedupeReadinessIssues(issues);

  return {
    checkedAt: toIsoString(Date.now()),
    issues: dedupedIssues,
    ready: dedupedIssues.every((issue) => issue.severity !== "error"),
  };
}
