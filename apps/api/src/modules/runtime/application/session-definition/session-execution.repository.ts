import { AGENT_KIND_LIST_LABEL, AgentKind } from "@mosoo/contracts/agent";
import type { EnvironmentNetworkPolicy } from "@mosoo/contracts/environment";
import type { AgentMcpCredentialMode } from "@mosoo/contracts/mcp";
import type { SkillResolutionMode } from "@mosoo/contracts/skill";
import { sessionExecutionSnapshotsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type {
  AgentDeploymentVersionId,
  AgentId,
  CredentialId,
  EnvironmentId,
  EnvironmentRevisionId,
  McpServerId,
  PlatformId,
  SessionId,
  SkillId,
  SkillSnapshotId,
} from "@mosoo/id";
import { eq } from "drizzle-orm";

import { getAppDatabase } from "../../../../platform/db/drizzle";
import type { SessionExecutionPlan } from "./session-execution.types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`${field} must be an object.`);
  }

  return value;
}

function readArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${field} must be an array.`);
  }

  return value;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${field} must be a string.`);
  }

  return value;
}

function readPlatformId(value: unknown, field: string): PlatformId {
  return parsePlatformId(value, field);
}

function readNullablePlatformId(value: unknown, field: string): PlatformId | null {
  if (value === null) {
    return null;
  }

  return readPlatformId(value, field);
}

function readNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${field} must be a finite number.`);
  }

  return value;
}

function readNullableNumber(value: unknown, field: string): number | null {
  if (value === null) {
    return null;
  }

  return readNumber(value, field);
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${field} must be a boolean.`);
  }

  return value;
}

function readAgentKind(value: unknown, field: string): AgentKind {
  if (AgentKind.allows(value)) {
    return value;
  }

  throw new Error(`${field} must be ${AGENT_KIND_LIST_LABEL}.`);
}

function readNetworkPolicy(value: unknown, field: string): EnvironmentNetworkPolicy {
  if (value === "full" || value === "limited") {
    return value;
  }

  throw new Error(`${field} must be full or limited.`);
}

function readSkillResolutionMode(value: unknown, field: string): SkillResolutionMode {
  if (value === "auto" || value === "explicit" || value === "tombstone") {
    return value;
  }

  throw new Error(`${field} must be auto, explicit, or tombstone.`);
}

function readCredentialMode(value: unknown, field: string): AgentMcpCredentialMode {
  if (value === "agent_bound" || value === "runtime_resolved") {
    return value;
  }

  throw new Error(`${field} must be agent_bound or runtime_resolved.`);
}

function parseBinding(value: unknown): SessionExecutionPlan["binding"] {
  const record = readRecord(value, "sessionExecutionPlan.binding");

  return {
    agentId: readPlatformId(record["agentId"], "sessionExecutionPlan.binding.agentId") as AgentId,
    deploymentVersionId: readNullablePlatformId(
      record["deploymentVersionId"],
      "sessionExecutionPlan.binding.deploymentVersionId",
    ) as AgentDeploymentVersionId | null,
    deploymentVersionNumber: readNullableNumber(
      record["deploymentVersionNumber"],
      "sessionExecutionPlan.binding.deploymentVersionNumber",
    ),
    kind: readAgentKind(record["kind"], "sessionExecutionPlan.binding.kind"),
    model: readString(record["model"], "sessionExecutionPlan.binding.model"),
    prompt: readString(record["prompt"], "sessionExecutionPlan.binding.prompt"),
    provider: readString(record["provider"], "sessionExecutionPlan.binding.provider"),
    runtimeId: readString(record["runtimeId"], "sessionExecutionPlan.binding.runtimeId"),
  };
}

function parseEnvironment(value: unknown): SessionExecutionPlan["environment"] {
  const record = readRecord(value, "sessionExecutionPlan.environment");

  return {
    allowMcpServers: readBoolean(
      record["allowMcpServers"],
      "sessionExecutionPlan.environment.allowMcpServers",
    ),
    allowPackageManagers: readBoolean(
      record["allowPackageManagers"],
      "sessionExecutionPlan.environment.allowPackageManagers",
    ),
    allowedHostsJson: readString(
      record["allowedHostsJson"],
      "sessionExecutionPlan.environment.allowedHostsJson",
    ),
    envVarsJson: readString(record["envVarsJson"], "sessionExecutionPlan.environment.envVarsJson"),
    environmentId: readPlatformId(
      record["environmentId"],
      "sessionExecutionPlan.environment.environmentId",
    ) as EnvironmentId,
    environmentName: readString(
      record["environmentName"],
      "sessionExecutionPlan.environment.environmentName",
    ),
    networkPolicy: readNetworkPolicy(
      record["networkPolicy"],
      "sessionExecutionPlan.environment.networkPolicy",
    ),
    packagesJson: readString(
      record["packagesJson"],
      "sessionExecutionPlan.environment.packagesJson",
    ),
    revisionId: readPlatformId(
      record["revisionId"],
      "sessionExecutionPlan.environment.revisionId",
    ) as EnvironmentRevisionId,
    setupScript: readString(record["setupScript"], "sessionExecutionPlan.environment.setupScript"),
  };
}

function parseSkillReference(
  value: unknown,
  index: number,
): SessionExecutionPlan["skills"][number] {
  const field = `sessionExecutionPlan.skills.${index}`;
  const record = readRecord(value, field);

  return {
    resolutionMode: readSkillResolutionMode(record["resolutionMode"], `${field}.resolutionMode`),
    skillId: readPlatformId(record["skillId"], `${field}.skillId`) as SkillId,
    skillName: readString(record["skillName"], `${field}.skillName`),
    snapshotId: readNullablePlatformId(
      record["snapshotId"],
      `${field}.snapshotId`,
    ) as SkillSnapshotId | null,
    sortOrder: readNumber(record["sortOrder"], `${field}.sortOrder`),
  };
}

function parseToolReference(value: unknown, index: number): SessionExecutionPlan["tools"][number] {
  const field = `sessionExecutionPlan.tools.${index}`;
  const record = readRecord(value, field);

  return {
    agentCredentialId: readNullablePlatformId(
      record["agentCredentialId"],
      `${field}.agentCredentialId`,
    ) as CredentialId | null,
    credentialMode: readCredentialMode(record["credentialMode"], `${field}.credentialMode`),
    serverId: readPlatformId(record["serverId"], `${field}.serverId`) as McpServerId,
    sortOrder: readNumber(record["sortOrder"], `${field}.sortOrder`),
  };
}

function parseSessionExecutionPlanJson(planJson: string): SessionExecutionPlan {
  const parsed: unknown = JSON.parse(planJson);
  const record = readRecord(parsed, "sessionExecutionPlan");

  return {
    binding: parseBinding(record["binding"]),
    environment: parseEnvironment(record["environment"]),
    skills: readArray(record["skills"], "sessionExecutionPlan.skills").map(parseSkillReference),
    tools: readArray(record["tools"], "sessionExecutionPlan.tools").map(parseToolReference),
  };
}

export async function findSessionExecutionPlan(
  database: D1Database,
  sessionId: SessionId,
): Promise<SessionExecutionPlan | null> {
  const row =
    (await getAppDatabase(database)
      .select({ planJson: sessionExecutionSnapshotsTable.planJson })
      .from(sessionExecutionSnapshotsTable)
      .where(eq(sessionExecutionSnapshotsTable.sessionId, sessionId))
      .limit(1)
      .get()) ?? null;

  return row ? parseSessionExecutionPlanJson(row.planJson) : null;
}

export async function getSessionExecutionPlan(
  database: D1Database,
  sessionId: SessionId,
): Promise<SessionExecutionPlan> {
  const plan = await findSessionExecutionPlan(database, sessionId);

  if (!plan) {
    throw new Error("Session execution snapshot not found.");
  }

  return plan;
}
