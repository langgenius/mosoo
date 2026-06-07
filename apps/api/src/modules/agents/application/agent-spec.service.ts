import type { AgentEnvironmentConfig, AgentKind } from "@mosoo/contracts/agent";
import type { AgentManifest, AgentManifestMcpServerBinding } from "@mosoo/contracts/agent-manifest";
import { AGENT_MANIFEST_VERSION } from "@mosoo/contracts/agent-manifest";
import type {
  SessionExecutionSkillReference,
  SessionExecutionToolReference,
} from "@mosoo/contracts/session";
import {
  accountsTable,
  agentSkillsTable,
  agentSpaceBindingsTable,
  environmentRevisionsTable,
  environmentsTable,
  skillsTable,
  spacesTable,
} from "@mosoo/db";
import type {
  CredentialId,
  EnvironmentId,
  AgentId,
  McpServerId,
  OrganizationId,
  SkillId,
  SkillSnapshotId,
  SpaceId,
} from "@mosoo/id";
import { asc, eq, inArray, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import {
  makePackageSetupScript,
  parsePackagesJson,
  parseStoredEnvVarsJson,
} from "../../environments/application/environment-config";
import { listAgentBindingRows } from "../../mcp/application/mcp-agent-binding.repository";
import { loadAgentEnvironmentConfig } from "./agent-environment.service";
import {
  readMcpServerId,
  readNullableCredentialId,
  readNullableSkillSnapshotId,
  readSkillId,
  readSpaceId,
} from "./agent-platform-ids";
import { parseAgentStoredConfig, serializeAgentStoredConfig } from "./agent-stored-config.service";
import type { AgentRow } from "./agent-types";

interface EnvironmentNameRow {
  id: EnvironmentId;
  name: string;
  organizationId: OrganizationId;
}

export interface AgentSpecSkill {
  currentSnapshotId: SkillSnapshotId | null;
  ownerName: string | null;
  packagePath: string | null;
  skillId: SkillId;
  skillName: string;
  sortOrder: number;
  state: "active" | "tombstone";
}

export interface AgentSpecMcpBinding {
  agentCredentialId: CredentialId | null;
  authType: AgentManifestMcpServerBinding["authType"];
  credentialMode: AgentManifestMcpServerBinding["credentialMode"];
  credentialScope: AgentManifestMcpServerBinding["credentialScope"];
  enabled: boolean;
  iconUrl: string | null;
  name: string;
  serverId: McpServerId | null;
  sortOrder: number;
  source: AgentManifestMcpServerBinding["source"];
  url: string;
}

export interface AgentSpecSpaceBinding {
  alias: string;
  expectedName: string | null;
  sortOrder: number;
  spaceId: SpaceId;
}

export interface AgentSpec {
  agentId: AgentId;
  configJson: string;
  description: string | null;
  environment: AgentEnvironmentConfig;
  environmentManifest: {
    expectedName: string | null;
    secretNames: string[];
    setupScript: string;
  };
  kind: AgentKind;
  mcpBindings: AgentSpecMcpBinding[];
  model: string;
  name: string;
  prompt: string;
  provider: string;
  runtimeId: string;
  skills: AgentSpecSkill[];
  spaces: AgentSpecSpaceBinding[];
}

export interface AgentSpecMcpBindingSnapshot {
  agentCredentialId: string | null;
  credentialMode: AgentSpecMcpBinding["credentialMode"];
  enabled: boolean;
  serverId: McpServerId;
  sortOrder: number;
}

export interface AgentSpecSpaceBindingSnapshot {
  spaceId: SpaceId;
  sortOrder: number;
}

export async function getAgentEnvironmentName(
  database: D1Database,
  environmentId: EnvironmentId | null,
): Promise<EnvironmentNameRow | null> {
  if (!isTruthy(environmentId)) {
    return null;
  }

  return (
    (await getAppDatabase(database)
      .select({
        id: environmentsTable.id,
        name: environmentsTable.name,
        organizationId: environmentsTable.organizationId,
      })
      .from(environmentsTable)
      .where(eq(environmentsTable.id, environmentId))
      .limit(1)
      .get()) ?? null
  );
}

async function getAgentEnvironmentManifest(
  database: D1Database,
  environmentId: EnvironmentId | null,
): Promise<AgentSpec["environmentManifest"]> {
  if (!isTruthy(environmentId)) {
    return {
      expectedName: null,
      secretNames: [],
      setupScript: "",
    };
  }

  const row = await getAppDatabase(database)
    .select({
      envVarsJson: environmentRevisionsTable.envVarsJson,
      id: environmentsTable.id,
      name: environmentsTable.name,
      organizationId: environmentsTable.organizationId,
      packagesJson: environmentRevisionsTable.packagesJson,
      setupScript: environmentRevisionsTable.setupScript,
    })
    .from(environmentsTable)
    .innerJoin(
      environmentRevisionsTable,
      eq(environmentRevisionsTable.id, environmentsTable.currentRevisionId),
    )
    .where(eq(environmentsTable.id, environmentId))
    .limit(1)
    .get();

  if (!row) {
    return {
      expectedName: null,
      secretNames: [],
      setupScript: "",
    };
  }

  const packageSetupScript = makePackageSetupScript(parsePackagesJson(row.packagesJson));

  return {
    expectedName: row.name,
    secretNames: parseStoredEnvVarsJson(row.envVarsJson).map((envVar) => envVar.key),
    setupScript: [packageSetupScript, row.setupScript].filter(Boolean).join("\n\n"),
  };
}

export async function listAgentSpecSkills(
  database: D1Database,
  agentId: AgentId,
): Promise<AgentSpecSkill[]> {
  const results = await getAppDatabase(database)
    .select({
      currentSnapshotId: skillsTable.currentSnapshotId,
      ownerName: sql`${accountsTable.name}`.mapWith(accountsTable.name).as("ownerName"),
      skillId: agentSkillsTable.skillId,
      skillName: sql`${skillsTable.name}`.mapWith(skillsTable.name).as("skillName"),
      sortOrder: agentSkillsTable.sortOrder,
    })
    .from(agentSkillsTable)
    .leftJoin(skillsTable, eq(skillsTable.id, agentSkillsTable.skillId))
    .leftJoin(accountsTable, eq(accountsTable.id, skillsTable.ownerAccountId))
    .where(eq(agentSkillsTable.agentId, agentId))
    .orderBy(asc(agentSkillsTable.sortOrder))
    .all();

  return results.map((row) => ({
    currentSnapshotId:
      row.currentSnapshotId === null
        ? null
        : readNullableSkillSnapshotId(row.currentSnapshotId, "Skill snapshot ID"),
    ownerName: row.ownerName,
    packagePath: null,
    skillId: readSkillId(row.skillId),
    skillName: row.skillName ?? "(deleted)",
    sortOrder: row.sortOrder,
    state: isTruthy(row.skillName) ? "active" : "tombstone",
  }));
}

export async function listAgentSpecSkillsByIds(
  database: D1Database,
  skillIds: readonly SkillId[],
): Promise<AgentSpecSkill[]> {
  const uniqueSkillIds = [...new Set(skillIds)];

  if (uniqueSkillIds.length === 0) {
    return [];
  }

  const results = await getAppDatabase(database)
    .select({
      currentSnapshotId: skillsTable.currentSnapshotId,
      ownerName: sql`${accountsTable.name}`.mapWith(accountsTable.name).as("ownerName"),
      skillId: skillsTable.id,
      skillName: skillsTable.name,
    })
    .from(skillsTable)
    .leftJoin(accountsTable, eq(accountsTable.id, skillsTable.ownerAccountId))
    .where(inArray(skillsTable.id, uniqueSkillIds))
    .all();
  const rowsBySkillId = new Map(results.map((row) => [readSkillId(row.skillId), row]));

  return uniqueSkillIds.map((skillId, index) => {
    const row = rowsBySkillId.get(skillId);

    if (!row) {
      throw new Error(`Cannot bind Skill ${skillId}: Skill not found.`);
    }

    return {
      currentSnapshotId:
        row.currentSnapshotId === null
          ? null
          : readNullableSkillSnapshotId(row.currentSnapshotId, "Skill snapshot ID"),
      ownerName: row.ownerName,
      packagePath: null,
      skillId,
      skillName: row.skillName,
      sortOrder: index,
      state: "active" as const,
    };
  });
}

export async function listAgentSpecMcpBindings(
  database: D1Database,
  agentId: AgentId,
): Promise<AgentSpecMcpBinding[]> {
  const rows = await listAgentBindingRows(database, agentId);

  return rows.map((row, index) => ({
    agentCredentialId: readNullableCredentialId(row.agentCredentialId),
    authType: row.authType,
    credentialMode: row.credentialMode,
    credentialScope: row.credentialScope,
    enabled: row.enabled === 1,
    iconUrl: row.iconUrl,
    name: row.name,
    serverId: readMcpServerId(row.serverId),
    sortOrder: index,
    source: row.source,
    url: row.url,
  }));
}

async function listAgentSpecSpaces(
  database: D1Database,
  agentId: AgentId,
): Promise<AgentSpecSpaceBinding[]> {
  const results = await getAppDatabase(database)
    .select({
      name: spacesTable.name,
      sortOrder: agentSpaceBindingsTable.sortOrder,
      spaceId: agentSpaceBindingsTable.spaceId,
    })
    .from(agentSpaceBindingsTable)
    .leftJoin(spacesTable, eq(spacesTable.id, agentSpaceBindingsTable.spaceId))
    .where(eq(agentSpaceBindingsTable.agentId, agentId))
    .orderBy(asc(agentSpaceBindingsTable.sortOrder), asc(agentSpaceBindingsTable.createdAt))
    .all();

  return results.map((row, index) => ({
    alias: row.name ?? row.spaceId,
    expectedName: row.name,
    sortOrder: row.sortOrder ?? index,
    spaceId: readSpaceId(row.spaceId),
  }));
}

export async function listAgentSpecSpacesByIds(
  database: D1Database,
  spaceIds: readonly SpaceId[],
): Promise<AgentSpecSpaceBinding[]> {
  const uniqueSpaceIds = [...new Set(spaceIds)];

  if (uniqueSpaceIds.length === 0) {
    return [];
  }

  const results = await getAppDatabase(database)
    .select({
      name: spacesTable.name,
      spaceId: spacesTable.id,
    })
    .from(spacesTable)
    .where(inArray(spacesTable.id, uniqueSpaceIds))
    .all();
  const rowsBySpaceId = new Map(results.map((row) => [readSpaceId(row.spaceId), row]));

  return uniqueSpaceIds.map((spaceId, index) => {
    const row = rowsBySpaceId.get(spaceId);

    if (!row) {
      throw new Error(`Cannot bind Space ${spaceId}: Space not found.`);
    }

    return {
      alias: row.name,
      expectedName: row.name,
      sortOrder: index,
      spaceId,
    };
  });
}

function normalizeStoredConfigJson(input: { configJson: string }): string {
  const stored = parseAgentStoredConfig(input.configJson);

  return serializeAgentStoredConfig({
    builder: stored.builder,
    packageMcpServers: stored.packageMcpServers,
    packageSkills: stored.packageSkills,
    packageResolution: stored.packageResolution,
    packageSharingEnabled: stored.packageSharingEnabled,
  });
}

export async function buildAgentSpec(database: D1Database, agent: AgentRow): Promise<AgentSpec> {
  const storedConfig = parseAgentStoredConfig(agent.configJson);
  const environment = await loadAgentEnvironmentConfig(database, agent.id, agent.environmentId);
  const [skills, registryMcpBindings, spaces, environmentManifest] = await Promise.all([
    listAgentSpecSkills(database, agent.id),
    listAgentSpecMcpBindings(database, agent.id),
    listAgentSpecSpaces(database, agent.id),
    getAgentEnvironmentManifest(database, environment.environmentId),
  ]);

  return buildAgentSpecFromProfile({
    agent,
    environment,
    environmentManifest,
    mcpBindings: registryMcpBindings,
    skills,
    spaces,
    storedConfig,
  });
}

function buildAgentSpecFromProfile(input: {
  agent: AgentRow;
  environment: AgentEnvironmentConfig;
  environmentManifest: AgentSpec["environmentManifest"];
  mcpBindings: AgentSpecMcpBinding[];
  skills: AgentSpecSkill[];
  spaces: AgentSpecSpaceBinding[];
  storedConfig: ReturnType<typeof parseAgentStoredConfig>;
}): AgentSpec {
  const packageMcpBindings = input.storedConfig.packageMcpServers.map((server, index) => ({
    agentCredentialId: null,
    authType: server.authType,
    credentialMode: server.credentialMode,
    credentialScope: server.credentialScope,
    enabled: server.enabled,
    iconUrl: server.iconUrl,
    name: server.name,
    serverId: null,
    sortOrder: input.mcpBindings.length + index,
    source: server.source,
    url: server.url,
  }));
  const packageSkills = input.storedConfig.packageSkills.map((skill) => ({
    currentSnapshotId: skill.currentSnapshotId,
    ownerName: skill.ownerName,
    packagePath: skill.packagePath,
    skillId: skill.skillId,
    skillName: skill.skillName,
    sortOrder: input.skills.length + skill.sortOrder,
    state: "active" as const,
  }));
  const allSkills = [...input.skills, ...packageSkills].toSorted((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }

    return left.skillName.localeCompare(right.skillName);
  });

  return {
    agentId: input.agent.id,
    configJson: normalizeStoredConfigJson({
      configJson: input.agent.configJson,
    }),
    description: input.agent.description,
    environment: input.environment,
    environmentManifest: input.environmentManifest,
    kind: input.agent.kind,
    mcpBindings: [...input.mcpBindings, ...packageMcpBindings],
    model: input.agent.model,
    name: input.agent.name,
    prompt: input.agent.prompt,
    provider: input.agent.provider,
    runtimeId: input.agent.runtimeId,
    skills: allSkills,
    spaces: input.spaces,
  };
}

export async function buildAgentSpecForPreparedProfile(
  database: D1Database,
  input: {
    agent: AgentRow;
    environment: AgentEnvironmentConfig;
    mcpBindings: AgentSpecMcpBinding[];
    skills: AgentSpecSkill[];
    spaces: AgentSpecSpaceBinding[];
  },
): Promise<AgentSpec> {
  const environmentManifest = await getAgentEnvironmentManifest(
    database,
    input.environment.environmentId,
  );

  return buildAgentSpecFromProfile({
    ...input,
    environmentManifest,
    storedConfig: parseAgentStoredConfig(input.agent.configJson),
  });
}

export function toAgentManifest(spec: AgentSpec): AgentManifest {
  return {
    advanced: null,
    environment: {
      envVars: Object.fromEntries(spec.environmentManifest.secretNames.map((key) => [key, ""])),
      environmentId: spec.environment.environmentId,
      expectedName: spec.environmentManifest.expectedName,
      setupScript: spec.environmentManifest.setupScript,
    },
    kind: spec.kind,
    manifestVersion: AGENT_MANIFEST_VERSION,
    mcpServers: spec.mcpBindings.map((binding) => ({
      authType: binding.authType,
      credentialMode: binding.credentialMode,
      credentialScope: binding.credentialScope,
      enabled: binding.enabled,
      iconUrl: binding.iconUrl,
      name: binding.name,
      serverId: binding.serverId,
      source: binding.source,
      url: binding.url,
    })),
    metadata: {
      description: spec.description,
      name: spec.name,
    },
    prompts: {
      system: spec.prompt,
    },
    runtime: {
      id: spec.runtimeId,
      model: spec.model,
      provider: spec.provider,
    },
    skills: spec.skills.map((skill) => ({
      ownerName: skill.ownerName,
      skillId: skill.packagePath ?? skill.skillId,
      skillName: skill.skillName,
      state: skill.state,
    })),
    spaces: spec.spaces.map((space) => ({
      alias: space.alias,
      expectedName: space.expectedName,
      mode: "read",
      required: true,
      spaceId: space.spaceId,
    })),
  };
}

export function toAgentSpecSkillReferences(
  spec: Pick<AgentSpec, "skills">,
): Omit<SessionExecutionSkillReference, "sessionId">[] {
  return spec.skills.map((skill) => ({
    resolutionMode: isTruthy(skill.currentSnapshotId) ? "explicit" : "tombstone",
    skillId: skill.skillId,
    skillName: skill.skillName,
    snapshotId: skill.currentSnapshotId,
    sortOrder: skill.sortOrder,
  }));
}

export function toAgentSpecToolReferences(
  spec: Pick<AgentSpec, "mcpBindings">,
): Omit<SessionExecutionToolReference, "sessionId">[] {
  return spec.mcpBindings.flatMap((binding): Omit<SessionExecutionToolReference, "sessionId">[] => {
    if (!binding.enabled || !isTruthy(binding.serverId)) {
      return [];
    }

    return [
      {
        agentCredentialId: binding.agentCredentialId,
        credentialMode: binding.credentialMode,
        serverId: binding.serverId,
        sortOrder: binding.sortOrder,
      },
    ];
  });
}

export function toAgentSpecMcpBindingSnapshots(
  spec: Pick<AgentSpec, "mcpBindings">,
): AgentSpecMcpBindingSnapshot[] {
  return spec.mcpBindings.flatMap((binding): AgentSpecMcpBindingSnapshot[] => {
    if (!isTruthy(binding.serverId)) {
      return [];
    }

    return [
      {
        agentCredentialId: binding.agentCredentialId,
        credentialMode: binding.credentialMode,
        enabled: binding.enabled,
        serverId: binding.serverId,
        sortOrder: binding.sortOrder,
      },
    ];
  });
}

export function toAgentSpecSpaceBindingSnapshots(
  spec: Pick<AgentSpec, "spaces">,
): AgentSpecSpaceBindingSnapshot[] {
  return spec.spaces.map((space) => ({
    sortOrder: space.sortOrder,
    spaceId: space.spaceId,
  }));
}
