import type { AgentDeploymentVersion, AgentEnvironmentConfig } from "@mosoo/contracts/agent";
import type {
  SessionExecutionSkillReference,
  SessionExecutionToolReference,
} from "@mosoo/contracts/session";
import { NonEmptyString, parseSchemaValue } from "@mosoo/contracts/validation";
import { agentDeploymentVersionsTable, agentsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { AccountId, AgentDeploymentVersionId, AgentId, EnvironmentId } from "@mosoo/id";
import { type } from "arktype";
import { desc, eq, sql } from "drizzle-orm";

import { getAppDatabase, runAppDatabaseBatch } from "../../../platform/db/drizzle";
import { API_ERROR_CODE, createApiError } from "../../../platform/errors";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs, toIsoString } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  readAccountId,
  readAgentDeploymentVersionId,
  readAgentId,
  readMcpServerId,
  readNullableCredentialId,
  readNullableEnvironmentId,
  readNullableSkillSnapshotId,
  readSkillId,
  readSpaceId,
} from "./agent-platform-ids";
import { getAgentRow } from "./agent-repository";
import { toAgentRuntimeModelProjection } from "./agent-runtime-model-identity";
import {
  buildAgentSpec,
  listAgentSpecMcpBindings,
  listAgentSpecSkills,
  toAgentSpecMcpBindingSnapshots,
  toAgentSpecSkillReferences,
  toAgentSpecSpaceBindingSnapshots,
  toAgentSpecToolReferences,
} from "./agent-spec.service";
import type {
  AgentSpec,
  AgentSpecMcpBindingSnapshot,
  AgentSpecSpaceBindingSnapshot,
} from "./agent-spec.service";
import { normalizeAgentStoredConfigJson } from "./agent-stored-config.service";
import type { AgentRow } from "./agent-types";

interface AgentDeploymentVersionRow {
  agentId: AgentId;
  configJson: string;
  createdAt: number;
  createdByAccountId: AccountId;
  environmentId: EnvironmentId | null;
  id: AgentDeploymentVersionId;
  kind: AgentDeploymentVersion["kind"];
  mcpBindingsJson: string;
  model: string;
  prompt: string;
  provider: string;
  runtimeId: string;
  skillsJson: string;
  spaceBindingsJson: string;
  summary: string;
  versionNumber: number;
}

const deploymentVersionColumns = {
  agentId: agentDeploymentVersionsTable.agentId,
  configJson: agentDeploymentVersionsTable.configJson,
  createdAt: agentDeploymentVersionsTable.createdAt,
  createdByAccountId: agentDeploymentVersionsTable.createdByAccountId,
  environmentId: agentDeploymentVersionsTable.environmentId,
  id: agentDeploymentVersionsTable.id,
  kind: agentDeploymentVersionsTable.kind,
  mcpBindingsJson: agentDeploymentVersionsTable.mcpBindingsJson,
  model: agentDeploymentVersionsTable.model,
  prompt: agentDeploymentVersionsTable.prompt,
  provider: agentDeploymentVersionsTable.provider,
  runtimeId: agentDeploymentVersionsTable.runtimeId,
  skillsJson: agentDeploymentVersionsTable.skillsJson,
  spaceBindingsJson: agentDeploymentVersionsTable.spaceBindingsJson,
  summary: agentDeploymentVersionsTable.summary,
  versionNumber: agentDeploymentVersionsTable.versionNumber,
};

export type AgentVersionMcpBindingSnapshot = AgentSpecMcpBindingSnapshot;
export type AgentVersionSpaceBindingSnapshot = AgentSpecSpaceBindingSnapshot;

const AgentVersionMcpBindingSnapshotJson = type({
  agentCredentialId: NonEmptyString.or("null"),
  credentialMode: '"runtime_resolved" | "agent_bound"',
  enabled: "boolean",
  serverId: NonEmptyString,
  sortOrder: "number",
});

const AgentVersionSkillReferenceJson = type({
  resolutionMode: '"auto" | "explicit" | "tombstone"',
  skillId: NonEmptyString,
  skillName: NonEmptyString,
  snapshotId: NonEmptyString.or("null"),
  sortOrder: "number",
});

const AgentVersionSpaceBindingSnapshotJson = type({
  spaceId: NonEmptyString,
  sortOrder: "number",
});

// Hoisted .array() schemas: arktype lazy-compiles via `new Function`, which
// workerd permits only during module init, not per-request.
const AgentVersionMcpBindingSnapshotJsonArray = AgentVersionMcpBindingSnapshotJson.array();
const AgentVersionSkillReferenceJsonArray = AgentVersionSkillReferenceJson.array();
const AgentVersionSpaceBindingSnapshotJsonArray = AgentVersionSpaceBindingSnapshotJson.array();

export interface AgentDeploymentVersionRecord {
  agentId: AgentId;
  configJson: string;
  createdAt: number;
  createdByAccountId: AccountId;
  environmentId: EnvironmentId | null;
  id: AgentDeploymentVersionId;
  kind: AgentDeploymentVersion["kind"];
  mcpBindings: AgentVersionMcpBindingSnapshot[];
  model: string;
  prompt: string;
  provider: string;
  runtimeId: string;
  skills: Omit<SessionExecutionSkillReference, "sessionId">[];
  spaceBindings: AgentVersionSpaceBindingSnapshot[];
  summary: string;
  versionNumber: number;
}

export interface AgentDeploymentVersionCandidate {
  record: AgentDeploymentVersionRecord;
  values: typeof agentDeploymentVersionsTable.$inferInsert;
}

function toRecord(row: AgentDeploymentVersionRow): AgentDeploymentVersionRecord {
  const runtimeModel = toAgentRuntimeModelProjection(row);
  const mcpBindings: AgentVersionMcpBindingSnapshot[] = parseSchemaValue(
    AgentVersionMcpBindingSnapshotJsonArray,
    JSON.parse(row.mcpBindingsJson),
  ).map((binding) => ({
    agentCredentialId: readNullableCredentialId(binding.agentCredentialId),
    credentialMode: binding.credentialMode,
    enabled: binding.enabled,
    serverId: readMcpServerId(binding.serverId),
    sortOrder: binding.sortOrder,
  }));

  const skills: Omit<SessionExecutionSkillReference, "sessionId">[] = parseSchemaValue(
    AgentVersionSkillReferenceJsonArray,
    JSON.parse(row.skillsJson),
  ).map((skill) => ({
    resolutionMode: skill.resolutionMode,
    skillId: readSkillId(skill.skillId),
    skillName: skill.skillName,
    snapshotId: readNullableSkillSnapshotId(skill.snapshotId),
    sortOrder: skill.sortOrder,
  }));

  const spaceBindings: AgentVersionSpaceBindingSnapshot[] = parseSchemaValue(
    AgentVersionSpaceBindingSnapshotJsonArray,
    JSON.parse(row.spaceBindingsJson),
  ).map((binding) => ({
    sortOrder: binding.sortOrder,
    spaceId: readSpaceId(binding.spaceId),
  }));

  return {
    agentId: readAgentId(row.agentId, "Agent ID"),
    configJson: normalizeAgentStoredConfigJson(row.configJson),
    createdAt: row.createdAt,
    createdByAccountId: readAccountId(row.createdByAccountId, "Account ID"),
    environmentId: readNullableEnvironmentId(row.environmentId, "Environment ID"),
    id: readAgentDeploymentVersionId(row.id, "Agent deployment version ID"),
    kind: row.kind,
    mcpBindings,
    model: runtimeModel.model,
    prompt: row.prompt,
    provider: runtimeModel.provider,
    runtimeId: runtimeModel.runtimeId,
    skills,
    spaceBindings,
    summary: row.summary,
    versionNumber: row.versionNumber,
  };
}

export async function listAgentSkillReferences(
  database: D1Database,
  agentId: AgentId,
): Promise<Omit<SessionExecutionSkillReference, "sessionId">[]> {
  const agent = await getAgentRow(database, agentId);
  const spec = await buildAgentSpec(database, agent);
  return toAgentSpecSkillReferences(spec);
}

export async function listEditableAgentSkillReferences(
  database: D1Database,
  agentId: AgentId,
): Promise<Omit<SessionExecutionSkillReference, "sessionId">[]> {
  const skills = await listAgentSpecSkills(database, agentId);
  return toAgentSpecSkillReferences({ skills });
}

export async function listAgentToolReferences(
  database: D1Database,
  agentId: AgentId,
): Promise<Omit<SessionExecutionToolReference, "sessionId">[]> {
  const mcpBindings = await listAgentSpecMcpBindings(database, agentId);
  return toAgentSpecToolReferences({ mcpBindings });
}

async function getNextVersionNumber(database: D1Database, agentId: AgentId): Promise<number> {
  const row = await getAppDatabase(database)
    .select({
      nextVersionNumber: sql<number>`COALESCE(MAX(${agentDeploymentVersionsTable.versionNumber}), 0) + 1`,
    })
    .from(agentDeploymentVersionsTable)
    .where(eq(agentDeploymentVersionsTable.agentId, agentId))
    .get();

  return row?.nextVersionNumber ?? 1;
}

export async function createLiveAgentDeploymentVersion(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: {
    agentId: AgentId;
    summary: string;
  },
): Promise<AgentDeploymentVersionRecord> {
  const agent = await getAgentRow(database, input.agentId);
  const spec = await buildAgentSpec(database, agent);
  const candidate = await prepareAgentDeploymentVersionCandidate(database, viewer, {
    agent,
    spec,
    summary: input.summary,
  });

  await runAppDatabaseBatch(database, (db) => [
    db.insert(agentDeploymentVersionsTable).values(candidate.values),
    db
      .update(agentsTable)
      .set({ liveDeploymentVersionId: candidate.record.id, updatedAt: candidate.record.createdAt })
      .where(eq(agentsTable.id, agent.id)),
  ]);

  return candidate.record;
}

export async function prepareAgentDeploymentVersionCandidate(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: {
    agent: AgentRow;
    spec: AgentSpec;
    summary: string;
    timestampMs?: number;
  },
): Promise<AgentDeploymentVersionCandidate> {
  const agent = input.agent;
  const spec = input.spec;
  const versionId = createPlatformId<AgentDeploymentVersionId>();
  const timestampMs = input.timestampMs ?? currentTimestampMs();
  const versionNumber = await getNextVersionNumber(database, agent.id);
  const skills = toAgentSpecSkillReferences(spec);
  const mcpBindings = toAgentSpecMcpBindingSnapshots(spec);
  const spaceBindings = toAgentSpecSpaceBindingSnapshots(spec);
  const values: typeof agentDeploymentVersionsTable.$inferInsert = {
    agentId: agent.id,
    configJson: spec.configJson,
    createdAt: timestampMs,
    createdByAccountId: viewer.id,
    environmentId: spec.environment.environmentId,
    id: versionId,
    kind: spec.kind,
    mcpBindingsJson: JSON.stringify(mcpBindings),
    model: spec.model,
    prompt: spec.prompt,
    provider: spec.provider,
    runtimeId: spec.runtimeId,
    skillsJson: JSON.stringify(skills),
    spaceBindingsJson: JSON.stringify(spaceBindings),
    summary: input.summary,
    versionNumber,
  };

  return {
    record: {
      agentId: agent.id,
      configJson: spec.configJson,
      createdAt: timestampMs,
      createdByAccountId: readAccountId(viewer.id, "Account ID"),
      environmentId: spec.environment.environmentId,
      id: versionId,
      kind: spec.kind,
      mcpBindings,
      model: spec.model,
      prompt: spec.prompt,
      provider: spec.provider,
      runtimeId: spec.runtimeId,
      skills,
      spaceBindings,
      summary: input.summary,
      versionNumber,
    },
    values,
  };
}

export async function getAgentDeploymentVersionRecord(
  database: D1Database,
  deploymentVersionId: AgentDeploymentVersionId,
): Promise<AgentDeploymentVersionRecord> {
  const record = await getAgentDeploymentVersionRecordOrNull(database, deploymentVersionId);

  if (!record) {
    throw new Error("Agent deployment version not found.");
  }

  return record;
}

async function getAgentDeploymentVersionRecordOrNull(
  database: D1Database,
  deploymentVersionId: AgentDeploymentVersionId,
): Promise<AgentDeploymentVersionRecord | null> {
  const row = await getAppDatabase(database)
    .select(deploymentVersionColumns)
    .from(agentDeploymentVersionsTable)
    .where(eq(agentDeploymentVersionsTable.id, deploymentVersionId))
    .limit(1)
    .get();

  return row ? toRecord(row) : null;
}

export async function getAgentLiveDeploymentVersionRecord(
  database: D1Database,
  agent: AgentRow,
): Promise<AgentDeploymentVersionRecord | null> {
  if (!isTruthy(agent.liveDeploymentVersionId)) {
    if (agent.status === "published") {
      throw createApiError(
        API_ERROR_CODE.agentLiveVersionRequired,
        "Public API Agent is missing a live deployment version.",
      );
    }

    return null;
  }

  const liveVersion = await getAgentDeploymentVersionRecordOrNull(
    database,
    agent.liveDeploymentVersionId,
  );

  if (!liveVersion) {
    throw createApiError(
      API_ERROR_CODE.agentLiveVersionRequired,
      "Agent live deployment version is missing.",
    );
  }

  return liveVersion;
}

export async function requireAgentLiveDeploymentVersionRecord(
  database: D1Database,
  agent: AgentRow,
): Promise<AgentDeploymentVersionRecord> {
  if (!isTruthy(agent.liveDeploymentVersionId)) {
    throw createApiError(
      API_ERROR_CODE.agentLiveVersionRequired,
      "Public API Agent is missing a live deployment version.",
    );
  }

  const liveVersion = await getAgentDeploymentVersionRecordOrNull(
    database,
    agent.liveDeploymentVersionId,
  );

  if (!liveVersion) {
    throw createApiError(
      API_ERROR_CODE.agentLiveVersionRequired,
      "Public API Agent live deployment version is missing.",
    );
  }

  return liveVersion;
}

export async function listAgentDeploymentVersionRecords(
  database: D1Database,
  agentId: AgentId,
): Promise<AgentDeploymentVersionRecord[]> {
  const results = await getAppDatabase(database)
    .select(deploymentVersionColumns)
    .from(agentDeploymentVersionsTable)
    .where(eq(agentDeploymentVersionsTable.agentId, agentId))
    .orderBy(desc(agentDeploymentVersionsTable.versionNumber))
    .all();

  return results.map(toRecord);
}

export function toAgentDeploymentVersionModel(
  version: AgentDeploymentVersionRecord,
  liveDeploymentVersionId: AgentDeploymentVersionId | null,
): AgentDeploymentVersion {
  const runtimeModel = toAgentRuntimeModelProjection(version);

  return {
    agentId: version.agentId,
    createdAt: toIsoString(version.createdAt),
    createdByAccountId: version.createdByAccountId,
    environmentId: version.environmentId,
    id: version.id,
    isLive: version.id === liveDeploymentVersionId,
    kind: version.kind,
    model: runtimeModel.model,
    provider: runtimeModel.provider,
    runtimeId: runtimeModel.runtimeId,
    summary: version.summary,
    versionNumber: version.versionNumber,
  };
}

export function toVersionAgentEnvironmentConfig(
  version: AgentDeploymentVersionRecord,
): AgentEnvironmentConfig {
  return {
    boundSpaceIds: [...version.spaceBindings]
      .toSorted((left, right) => left.sortOrder - right.sortOrder)
      .map((binding) => binding.spaceId),
    environmentId: version.environmentId,
  };
}
