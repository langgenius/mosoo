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
import { getAppDatabase, runAppDatabaseBatch } from "../../../platform/db/drizzle";
import { forbiddenError } from "../../../platform/errors";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  canUseEnvironment,
  getProjectDefaultEnvironmentId,
} from "../../environments/application/environment.service";
import {
  listAgentMcpServerIds,
  deletePreparedAgentMcpBindingCredentials,
  prepareAgentMcpBindingsForConfig,
} from "../../mcp/application/mcp-agent-binding.service";
import { ensureProjectOwnership } from "../../projects/application/project.service";
import { ensureProjectAgentOwner } from "./agent-access.service";
import { prepareAgentDeploymentVersionCandidate } from "./agent-deployment-version.service";
import {
  loadAgentEnvironmentConfig,
  prepareAgentEnvironmentConfigWrite,
} from "./agent-environment.service";
import { enforceAgentKindChangeAllowed } from "./agent-kind-policy.service";
import { toAgentModel } from "./agent-models";
import {
  readAgentId,
  readEnvironmentId,
  readMcpServerId,
  readProjectId,
} from "./agent-platform-ids";
import { getAgentRow, replaceAgentSkills } from "./agent-repository";
import {
  ensureAgentSkillSelectionAccess,
  normalizeAgentSkillIds,
} from "./agent-skill-resolution.service";
import { buildAgentSpecForPreparedProfile, listAgentSpecSkillsByIds } from "./agent-spec.service";
import { parseAgentStoredConfig, serializeAgentStoredConfig } from "./agent-stored-config.service";
import {
  evaluateAgentRuntimeSelection,
  enforcePublishedRuntimeStability,
  createAgentConfigChangeSnapshot,
  listAgentSkillIds,
  planVersionedAgentConfigChange,
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
  bindings: Pick<
    ApiBindings,
    | "DB"
    | "MOSOO_DEPLOYMENT_MODE"
    | "MOSOO_ENVIRONMENT"
    | "POSTHOG_API_HOST"
    | "POSTHOG_PROJECT_KEY"
  >,
  viewer: AuthenticatedViewer,
  input: CreateAgentInput,
): Promise<Agent> {
  const database = bindings.DB;
  const projectId = readProjectId(input.projectId);
  await ensureProjectOwnership(database, viewer.id, projectId);
  const environmentId = readEnvironmentId(
    await getProjectDefaultEnvironmentId(database, projectId),
  );
  const runtimeSelection = evaluateAgentRuntimeSelection(input);

  if (!runtimeSelection.ok) {
    throw new Error(runtimeSelection.message);
  }

  const { runtimeId } = runtimeSelection;
  const skillIds = normalizeAgentSkillIds(input.skillIds);
  const timestampMs = currentTimestampMs();
  const agentId = createPlatformId<AgentId>();

  await ensureAgentSkillSelectionAccess(database, viewer, projectId, skillIds);

  await getAppDatabase(database)
    .insert(agentsTable)
    .values({
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
      kind: input.kind,
      model: input.model,
      name: input.name,
      ownerId: viewer.id,
      projectId,
      prompt: input.prompt,
      provider: input.provider,
      runtimeId,
      updatedAt: timestampMs,
    })
    .run();

  await replaceAgentSkills(database, agentId, skillIds, timestampMs);

  const createdAgent = await getAgentRow(database, agentId);
  await captureServerProductEvent(bindings, {
    distinctId: viewer.id,
    event: SERVER_PRODUCT_ANALYTICS_EVENTS.agentCreated,
    properties: {
      agent_id: agentId,
      project_id: projectId,
      agent_kind: input.kind,
      provider: input.provider,
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
  const agentId = readAgentId(input.agentId);
  const editable = await ensureProjectAgentOwner(database, viewer.id, {
    agentId,
    projectId: readProjectId(input.projectId),
  });
  const runtimeSelection = evaluateAgentRuntimeSelection(input);

  if (!runtimeSelection.ok) {
    throw new Error(runtimeSelection.message);
  }

  const { runtimeId } = runtimeSelection;
  enforceAgentKindChangeAllowed(editable.agent, input.kind);
  const skillIds = normalizeAgentSkillIds(input.skillIds);
  const timestampMs = currentTimestampMs();
  const currentEnvironment = await loadAgentEnvironmentConfig(
    database,
    editable.agent.id,
    editable.agent.environmentId,
  );
  const currentSkillIds = await listAgentSkillIds(database, editable.agent.id);
  const currentStoredConfig = parseAgentStoredConfig(editable.agent.configJson);
  const builtInTools =
    input.builtInTools === undefined
      ? currentStoredConfig.builtInTools
      : normalizeAgentBuiltInTools(input.builtInTools);
  const requestedProviderOptions = input.providerOptions ?? {};
  const providerOptionsUnchanged =
    stableStringify(currentStoredConfig.providerOptions) ===
    stableStringify(requestedProviderOptions);
  const providerOptions = assertRuntimeAdvancedSettings({
    allowLegacyUnsupportedSettings:
      providerOptionsUnchanged &&
      editable.agent.model === input.model &&
      editable.agent.runtimeId === runtimeId,
    modelId: input.model,
    runtimeId,
    settings: requestedProviderOptions,
  });
  const currentMcpServerIds = (await listAgentMcpServerIds(database, editable.agent.id)).map(
    (serverId) => readMcpServerId(serverId),
  );
  const preparedMcpBindings = await prepareAgentMcpBindingsForConfig(database, viewer, {
    agent: editable.agent,
    serverIds: input.mcpServerIds,
    updatedAt: timestampMs,
  });
  const mcpServerIds = preparedMcpBindings.rows.map((row) => readMcpServerId(row.serverId));
  const changePlan = planVersionedAgentConfigChange({
    agentStatus: editable.agent.status,
    current: createAgentConfigChangeSnapshot({
      agent: {
        ...editable.agent,
        builtInTools: currentStoredConfig.builtInTools,
        providerOptions: currentStoredConfig.providerOptions,
      },
      environment: currentEnvironment,
      mcpServerIds: currentMcpServerIds,
      skillIds: currentSkillIds,
    }),
    next: createAgentConfigChangeSnapshot({
      agent: {
        ...editable.agent,
        builtInTools,
        description: input.description ?? null,
        kind: input.kind,
        model: input.model,
        name: input.name,
        prompt: input.prompt,
        provider: input.provider,
        providerOptions,
        runtimeId,
      },
      environment: input.environment,
      mcpServerIds,
      skillIds,
    }),
  });
  const { environmentId } = input.environment;

  enforcePublishedRuntimeStability(editable.agent, runtimeId);
  await ensureAgentSkillSelectionAccess(database, viewer, editable.agent.projectId, skillIds);
  if (
    environmentId !== null &&
    environmentId !== "" &&
    !(await canUseEnvironment(database, editable.agent.ownerId, {
      environmentId,
      projectId: editable.agent.projectId,
    }))
  ) {
    throw forbiddenError("Selected Environment is not available to the agent owner.");
  }

  const preparedEnvironment = prepareAgentEnvironmentConfigWrite({
    agentId: editable.agent.id,
    currentConfigJson: editable.agent.configJson,
    environment: input.environment,
    builtInTools,
    providerOptions,
    updatedAt: timestampMs,
  });
  const nextAgent = {
    ...editable.agent,
    configJson: preparedEnvironment.configJson,
    description: input.description ?? null,
    environmentId: preparedEnvironment.environmentId,
    kind: input.kind,
    model: input.model,
    name: input.name,
    prompt: input.prompt,
    provider: input.provider,
    runtimeId,
    updatedAt: timestampMs,
  };
  const specSkills = await listAgentSpecSkillsByIds(database, skillIds);
  const spec = await buildAgentSpecForPreparedProfile(database, {
    agent: nextAgent,
    environment: preparedEnvironment.environment,
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
    agentId: editable.agent.id,
    createdAt: timestampMs,
    skillId,
    sortOrder: index,
  }));

  await deletePreparedAgentMcpBindingCredentials(database, preparedMcpBindings);

  await runAppDatabaseBatch(database, (db) => [
    db
      .update(agentsTable)
      .set({
        configJson: preparedEnvironment.configJson,
        description: input.description ?? null,
        environmentId: preparedEnvironment.environmentId,
        kind: input.kind,
        ...(deploymentVersion ? { liveDeploymentVersionId: deploymentVersion.record.id } : {}),
        model: input.model,
        name: input.name,
        prompt: input.prompt,
        provider: input.provider,
        runtimeId,
        updatedAt: timestampMs,
      })
      .where(eq(agentsTable.id, editable.agent.id)),
    ...(deploymentVersion
      ? [db.insert(agentDeploymentVersionsTable).values(deploymentVersion.values)]
      : []),
    db.delete(agentSkillsTable).where(eq(agentSkillsTable.agentId, editable.agent.id)),
    ...(skillRows.length > 0 ? [db.insert(agentSkillsTable).values(skillRows)] : []),
    db.delete(agentMcpBindingsTable).where(eq(agentMcpBindingsTable.agentId, editable.agent.id)),
    ...(preparedMcpBindings.rows.length > 0
      ? [db.insert(agentMcpBindingsTable).values(preparedMcpBindings.rows)]
      : []),
  ]);

  const updatedAgent = await getAgentRow(database, editable.agent.id);

  return toAgentModel(database, viewer, updatedAgent);
}
