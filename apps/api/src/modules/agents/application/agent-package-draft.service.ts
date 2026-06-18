import type { JsonObject } from "@mosoo/contracts";
import type { AgentKind } from "@mosoo/contracts/agent";
import type {
  AgentManifestMcpServerBinding,
  AgentPackageResolutionState,
} from "@mosoo/contracts/agent-manifest";
import { agentMcpBindingsTable, agentSkillsTable, agentsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type {
  AccountId,
  AgentMcpBindingId,
  AgentId,
  EnvironmentId,
  McpServerId,
  AppId,
  SkillId,
} from "@mosoo/id";

import { getAppDatabase, runAppDatabaseBatch } from "../../../platform/db/drizzle";
import type { AppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { getAgentRow } from "./agent-repository";
import { normalizeAgentSkillIds } from "./agent-skill-resolution.service";
import { serializeAgentStoredConfig } from "./agent-stored-config.service";
import type { AgentStoredPackageSkill } from "./agent-stored-config.service";
import type { AgentRow } from "./agent-types";

export interface CreateDraftAgentInput {
  agentName: string;
  description: string | null;
  environmentId: EnvironmentId | null;
  kind: AgentKind;
  model: string;
  ownerId: AccountId;
  packageMcpServers: AgentManifestMcpServerBinding[];
  packageResolution: AgentPackageResolutionState | null;
  packageSkills: AgentStoredPackageSkill[];
  prompt: string;
  provider: string;
  providerOptions: JsonObject;
  appId: AppId;
  runtimeId: string;
  skillIds: SkillId[];
}

export interface CreateDraftAgentBatchInput extends CreateDraftAgentInput {
  mcpServerIds?: readonly McpServerId[];
}

type AppDatabaseBatchItem = Parameters<AppDatabase["batch"]>[0][number];

export async function createDraftAgent(
  database: D1Database,
  input: CreateDraftAgentInput,
): Promise<AgentRow> {
  return createDraftAgentBatch(database, input);
}

export async function createDraftAgentBatch(
  database: D1Database,
  input: CreateDraftAgentBatchInput,
): Promise<AgentRow> {
  const agentId = createPlatformId<AgentId>();
  const timestampMs = currentTimestampMs();
  const uniqueSkillIds = normalizeAgentSkillIds(input.skillIds);
  const uniqueMcpServerIds = [...new Set(input.mcpServerIds ?? [])];

  await runAppDatabaseBatch(database, (db) => {
    const agentInsert = db.insert(agentsTable).values({
      configJson: serializeAgentStoredConfig({
        builder: { componentDecisions: {} },
        packageMcpServers: input.packageMcpServers,
        packageSkills: input.packageSkills,
        packageResolution: input.packageResolution,
        providerOptions: input.providerOptions,
      }),
      createdAt: timestampMs,
      description: input.description,
      environmentId: input.environmentId,
      id: agentId,
      kind: input.kind,
      model: input.model,
      name: input.agentName,
      ownerId: input.ownerId,
      prompt: input.prompt,
      provider: input.provider,
      appId: input.appId,
      runtimeId: input.runtimeId,
      status: "draft",
      updatedAt: timestampMs,
      visibility: "private",
    });
    const queries: [AppDatabaseBatchItem, ...AppDatabaseBatchItem[]] = [agentInsert];

    if (uniqueSkillIds.length > 0) {
      queries.push(
        db.insert(agentSkillsTable).values(
          uniqueSkillIds.map((skillId, index) => ({
            agentId,
            createdAt: timestampMs,
            skillId,
            sortOrder: index,
          })),
        ),
      );
    }

    if (uniqueMcpServerIds.length > 0) {
      queries.push(
        db.insert(agentMcpBindingsTable).values(
          uniqueMcpServerIds.map((serverId, index) => ({
            agentCredentialId: null,
            agentId,
            createdAt: timestampMs,
            credentialMode: "runtime_resolved" as const,
            enabled: true,
            id: createPlatformId<AgentMcpBindingId>(),
            serverId,
            sortOrder: index,
            updatedAt: timestampMs,
          })),
        ),
      );
    }

    return queries;
  });

  return getAgentRow(database, agentId);
}

export async function bindDraftAgentMcpServers(
  database: D1Database,
  agentId: AgentId,
  serverIds: readonly McpServerId[],
): Promise<void> {
  if (serverIds.length === 0) {
    return;
  }

  const timestampMs = currentTimestampMs();

  await getAppDatabase(database)
    .insert(agentMcpBindingsTable)
    .values(
      [...new Set(serverIds)].map((serverId, index) => ({
        agentCredentialId: null,
        agentId,
        createdAt: timestampMs,
        credentialMode: "runtime_resolved" as const,
        enabled: true,
        id: createPlatformId<AgentMcpBindingId>(),
        serverId,
        sortOrder: index,
        updatedAt: timestampMs,
      })),
    )
    .run();
}
