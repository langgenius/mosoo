import { getAgentBuiltInToolSupportError } from "@mosoo/contracts/agent";
import type { Agent, CreateAgentInput, UpdateAgentConfigInput } from "@mosoo/contracts/agent";
import { createDefaultAgentBuiltInTools, normalizeAgentBuiltInTools } from "@mosoo/contracts/agent";
import {
  agentDeploymentVersionsTable,
  agentMcpBindingsTable,
  agentsTable,
  agentSkillsTable,
} from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { AgentId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import {
  captureServerProductEvent,
  SERVER_PRODUCT_ANALYTICS_EVENTS,
} from "../../../platform/analytics/product-analytics";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { runAppDatabaseBatch } from "../../../platform/db/drizzle";
import { validationError } from "../../../platform/errors";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureEnvironmentAccess } from "../../environments/application/environment-access.service";
import { getProjectDefaultEnvironmentId } from "../../environments/application/environment-defaults";
import {
  listAgentMcpServerIds,
  prepareAgentMcpBindingsForConfig,
} from "../../mcp/application/mcp-agent-binding.service";
import { ensureProjectOwnership } from "../../projects/application/project.service";
import { ensureProjectAgentOwner } from "./agent-access.service";
import { prepareAgentDeploymentVersionCandidate } from "./agent-deployment-version.service";
import { toAgentModel } from "./agent-models";
import { getAgentRow } from "./agent-repository";
import {
  ensureAgentSkillSelectionAccess,
  normalizeAgentSkillIds,
} from "./agent-skill-resolution.service";
import { buildAgentSpecForPreparedProfile, listAgentSpecSkillsByIds } from "./agent-spec.service";
import { parseAgentStoredConfig, serializeAgentStoredConfig } from "./agent-stored-config.service";
import {
  createAgentConfigChangeSnapshot,
  listAgentSkillIds,
  planVersionedAgentConfigChange,
  requireAgentRuntimeSelection,
  summarizeVersionedAgentConfigChange,
} from "./agent-versioned-config.service";
import { assertRuntimeAdvancedSettings } from "./runtime-advanced-settings-validation.service";
export { deleteAgent, publishAgent, unpublishAgent } from "./agent-lifecycle-command.service";

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).toSorted(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }

  const serialized = JSON.stringify(value);
  return typeof serialized === "string" ? serialized : "undefined";
}

export async function createAgent(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: CreateAgentInput,
): Promise<Agent> {
  const database = bindings.DB;
  const { projectId } = input;
  await ensureProjectOwnership(database, viewer.id, projectId);
  const environmentId = await getProjectDefaultEnvironmentId(database, projectId);
  const { model, provider, runtimeId } = requireAgentRuntimeSelection(input);
  const skillIds = normalizeAgentSkillIds(input.skillIds);
  const timestampMs = currentTimestampMs();
  const agentId = createPlatformId<AgentId>();

  await ensureAgentSkillSelectionAccess(database, viewer, projectId, skillIds);

  await runAppDatabaseBatch(database, (db) => [
    db.insert(agentsTable).values({
      configJson: serializeAgentStoredConfig({
        builtInTools: createDefaultAgentBuiltInTools(),
        packageMcpServers: [],
        packageSkills: [],
        packageResolution: null,
        providerOptions: {},
      }),
      createdAt: timestampMs,
      description: input.description ?? null,
      environmentId,
      id: agentId,
      kind: "cattle",
      model,
      name: input.name,
      ownerId: viewer.id,
      projectId,
      prompt: input.prompt,
      provider,
      runtimeId,
      updatedAt: timestampMs,
    }),
    ...(skillIds.length > 0
      ? [
          db.insert(agentSkillsTable).values(
            skillIds.map((skillId, index) => ({
              agentId,
              createdAt: timestampMs,
              skillId,
              sortOrder: index,
            })),
          ),
        ]
      : []),
  ]);

  const createdAgent = await getAgentRow(database, agentId);
  await captureServerProductEvent(bindings, {
    distinctId: viewer.id,
    event: SERVER_PRODUCT_ANALYTICS_EVENTS.agentCreated,
    properties: {
      agent_id: agentId,
      project_id: projectId,
      provider,
      runtime_id: runtimeId,
    },
  });

  return toAgentModel(database, viewer, createdAgent);
}

export async function updateAgentConfig(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: UpdateAgentConfigInput,
): Promise<Agent> {
  const agent = await ensureProjectAgentOwner(database, viewer.id, {
    agentId: input.agentId,
    projectId: input.projectId,
  });
  const { model, provider, runtimeId } = requireAgentRuntimeSelection(input);
  const skillIds = normalizeAgentSkillIds(input.skillIds);
  const timestampMs = currentTimestampMs();
  const currentSkillIds = await listAgentSkillIds(database, agent.id);
  const currentStoredConfig = parseAgentStoredConfig(agent.configJson);
  const builtInTools =
    input.builtInTools === undefined
      ? currentStoredConfig.builtInTools
      : normalizeAgentBuiltInTools(input.builtInTools);
  const toolSupportError = getAgentBuiltInToolSupportError(runtimeId, builtInTools);
  if (toolSupportError) throw validationError(toolSupportError);
  const requestedProviderOptions = input.providerOptions ?? {};
  const providerOptionsUnchanged =
    stableStringify(currentStoredConfig.providerOptions) ===
    stableStringify(requestedProviderOptions);
  const providerOptions = assertRuntimeAdvancedSettings({
    allowLegacyUnsupportedSettings:
      providerOptionsUnchanged && agent.model === model && agent.runtimeId === runtimeId,
    modelId: model,
    runtimeId,
    settings: requestedProviderOptions,
  });
  const currentMcpServerIds = await listAgentMcpServerIds(database, agent.id);
  const preparedMcpBindings = await prepareAgentMcpBindingsForConfig(database, {
    agent,
    serverIds: input.mcpServerIds,
    updatedAt: timestampMs,
  });
  const mcpServerIds = preparedMcpBindings.rows.map((row) => row.serverId);
  const { environmentId } = input.environment;
  const environment = { environmentId };
  const changePlan = planVersionedAgentConfigChange({
    agentStatus: agent.status,
    current: createAgentConfigChangeSnapshot({
      agent: {
        ...agent,
        builtInTools: currentStoredConfig.builtInTools,
        providerOptions: currentStoredConfig.providerOptions,
      },
      environment: { environmentId: agent.environmentId },
      mcpServerIds: currentMcpServerIds,
      skillIds: currentSkillIds,
    }),
    next: createAgentConfigChangeSnapshot({
      agent: {
        ...agent,
        builtInTools,
        description: input.description ?? null,
        model,
        name: input.name,
        prompt: input.prompt,
        provider,
        providerOptions,
        runtimeId,
      },
      environment,
      mcpServerIds,
      skillIds,
    }),
  });

  await ensureAgentSkillSelectionAccess(database, viewer, agent.projectId, skillIds);
  if (environmentId !== null && environmentId !== "") {
    await ensureEnvironmentAccess(database, agent.ownerId, {
      environmentId,
      projectId: agent.projectId,
    });
  }

  const configJson = serializeAgentStoredConfig({
    ...currentStoredConfig,
    builtInTools,
    providerOptions,
  });
  const nextAgent = {
    ...agent,
    configJson,
    description: input.description ?? null,
    environmentId,
    model,
    name: input.name,
    prompt: input.prompt,
    provider,
    runtimeId,
    updatedAt: timestampMs,
  };
  const specSkills = await listAgentSpecSkillsByIds(database, skillIds);
  const spec = await buildAgentSpecForPreparedProfile(database, {
    agent: nextAgent,
    environment,
    mcpBindings: preparedMcpBindings.specBindings,
    skills: specSkills,
  });

  const deploymentSummary = summarizeVersionedAgentConfigChange(changePlan);
  const deploymentVersion = changePlan.requiresDeploymentVersion
    ? await prepareAgentDeploymentVersionCandidate(database, viewer, {
        agent: nextAgent,
        spec,
        summary: deploymentSummary,
        timestampMs,
      })
    : null;
  const skillRows = skillIds.map((skillId, index) => ({
    agentId: agent.id,
    createdAt: timestampMs,
    skillId,
    sortOrder: index,
  }));

  await runAppDatabaseBatch(database, (db) => [
    db
      .update(agentsTable)
      .set({
        configJson,
        description: input.description ?? null,
        environmentId,
        ...(deploymentVersion ? { liveDeploymentVersionId: deploymentVersion.record.id } : {}),
        model,
        name: input.name,
        prompt: input.prompt,
        provider,
        runtimeId,
        updatedAt: timestampMs,
      })
      .where(eq(agentsTable.id, agent.id)),
    ...(deploymentVersion
      ? [db.insert(agentDeploymentVersionsTable).values(deploymentVersion.values)]
      : []),
    db.delete(agentSkillsTable).where(eq(agentSkillsTable.agentId, agent.id)),
    ...(skillRows.length > 0 ? [db.insert(agentSkillsTable).values(skillRows)] : []),
    db.delete(agentMcpBindingsTable).where(eq(agentMcpBindingsTable.agentId, agent.id)),
    ...(preparedMcpBindings.rows.length > 0
      ? [db.insert(agentMcpBindingsTable).values(preparedMcpBindings.rows)]
      : []),
  ]);

  const updatedAgent = await getAgentRow(database, agent.id);

  return toAgentModel(database, viewer, updatedAgent);
}
