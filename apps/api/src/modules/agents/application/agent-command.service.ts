import type { Agent, CreateAgentInput, UpdateAgentConfigInput } from "@mosoo/contracts/agent";
import {
  agentDeploymentVersionsTable,
  agentMcpBindingsTable,
  agentsTable,
  agentSkillsTable,
  agentSpaceBindingsTable,
} from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { AgentId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase, runAppDatabaseBatch } from "../../../platform/db/drizzle";
import { forbiddenError } from "../../../platform/errors";
import { currentTimestampMs } from "../../../time";
import { ensureAppOwnership } from "../../apps/application/app.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  canUseEnvironment,
  getAppDefaultEnvironmentId,
} from "../../environments/application/environment.service";
import {
  listAgentMcpServerIds,
  deletePreparedAgentMcpBindingCredentials,
  prepareAgentMcpBindingsForConfig,
} from "../../mcp/application/mcp-agent-binding.service";
import { ensureAppAgentOwner } from "./agent-access.service";
import { prepareAgentDeploymentVersionCandidate } from "./agent-deployment-version.service";
import {
  loadAgentEnvironmentConfig,
  prepareAgentEnvironmentConfigWrite,
} from "./agent-environment.service";
import { enforceAgentKindChangeAllowed } from "./agent-kind-policy.service";
import { toAgentModel } from "./agent-models";
import { readAgentId, readEnvironmentId, readMcpServerId, readAppId } from "./agent-platform-ids";
import { getAgentRow, replaceAgentSkills } from "./agent-repository";
import {
  ensureAgentSkillSelectionAccess,
  normalizeAgentSkillIds,
} from "./agent-skill-resolution.service";
import {
  buildAgentSpecForPreparedProfile,
  listAgentSpecSkillsByIds,
  listAgentSpecSpacesByIds,
} from "./agent-spec.service";
import { parseAgentStoredConfig, serializeAgentStoredConfig } from "./agent-stored-config.service";
import {
  evaluateAgentRuntimeSelection,
  ensureAgentOwnerCanReadBoundSpaces,
  enforcePublishedRuntimeStability,
  createAgentConfigChangeSnapshot,
  listAgentSkillIds,
  planVersionedAgentConfigChange,
  summarizeVersionedAgentConfigChange,
} from "./agent-versioned-config.service";
export { deleteAgent, publishAgent, unpublishAgent } from "./agent-lifecycle-command.service";

export async function createAgent(
  bindings: Pick<ApiBindings, "DB">,
  viewer: AuthenticatedViewer,
  input: CreateAgentInput,
): Promise<Agent> {
  const database = bindings.DB;
  const appId = readAppId(input.appId);
  await ensureAppOwnership(database, viewer.id, appId);
  const environmentId = readEnvironmentId(await getAppDefaultEnvironmentId(database, appId));
  const runtimeSelection = evaluateAgentRuntimeSelection(input);

  if (!runtimeSelection.ok) {
    throw new Error(runtimeSelection.message);
  }

  const { runtimeId } = runtimeSelection;
  const skillIds = normalizeAgentSkillIds(input.skillIds);
  const timestampMs = currentTimestampMs();
  const agentId = createPlatformId<AgentId>();

  await ensureAgentSkillSelectionAccess(database, viewer, appId, skillIds);

  await getAppDatabase(database)
    .insert(agentsTable)
    .values({
      configJson: serializeAgentStoredConfig({
        builder: { componentDecisions: {} },
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
      appId,
      prompt: input.prompt,
      provider: input.provider,
      runtimeId,
      updatedAt: timestampMs,
    })
    .run();

  await replaceAgentSkills(database, agentId, skillIds, timestampMs);

  const createdAgent = await getAgentRow(database, agentId);

  return toAgentModel(database, viewer, createdAgent);
}

export async function updateAgentConfig(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: UpdateAgentConfigInput,
): Promise<Agent> {
  const agentId = readAgentId(input.agentId);
  const editable = await ensureAppAgentOwner(database, viewer.id, {
    agentId,
    appId: readAppId(input.appId),
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
        providerOptions: currentStoredConfig.providerOptions,
      },
      environment: currentEnvironment,
      mcpServerIds: currentMcpServerIds,
      skillIds: currentSkillIds,
    }),
    next: createAgentConfigChangeSnapshot({
      agent: {
        ...editable.agent,
        description: input.description ?? null,
        kind: input.kind,
        model: input.model,
        name: input.name,
        prompt: input.prompt,
        provider: input.provider,
        providerOptions: input.providerOptions,
        runtimeId,
      },
      environment: input.environment,
      mcpServerIds,
      skillIds,
    }),
  });
  const { environmentId } = input.environment;

  enforcePublishedRuntimeStability(editable.agent, runtimeId);
  await ensureAgentSkillSelectionAccess(database, viewer, editable.agent.appId, skillIds);
  await ensureAgentOwnerCanReadBoundSpaces(
    database,
    editable.agent.ownerId,
    editable.agent.appId,
    input.environment.boundSpaceIds,
  );

  if (
    environmentId !== null &&
    environmentId !== "" &&
    !(await canUseEnvironment(database, editable.agent.ownerId, {
      environmentId,
      appId: editable.agent.appId,
    }))
  ) {
    throw forbiddenError("Selected Environment is not available to the agent owner.");
  }

  const preparedEnvironment = prepareAgentEnvironmentConfigWrite({
    agentId: editable.agent.id,
    builder: input.builder,
    currentConfigJson: editable.agent.configJson,
    environment: input.environment,
    providerOptions: input.providerOptions,
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
  const [specSkills, specSpaces] = await Promise.all([
    listAgentSpecSkillsByIds(database, skillIds),
    listAgentSpecSpacesByIds(database, preparedEnvironment.environment.boundSpaceIds),
  ]);
  const spec = await buildAgentSpecForPreparedProfile(database, {
    agent: nextAgent,
    environment: preparedEnvironment.environment,
    mcpBindings: preparedMcpBindings.specBindings,
    skills: specSkills,
    spaces: specSpaces,
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
    db
      .delete(agentSpaceBindingsTable)
      .where(eq(agentSpaceBindingsTable.agentId, editable.agent.id)),
    ...(preparedEnvironment.spaceRows.length > 0
      ? [db.insert(agentSpaceBindingsTable).values(preparedEnvironment.spaceRows)]
      : []),
  ]);

  const updatedAgent = await getAgentRow(database, editable.agent.id);

  return toAgentModel(database, viewer, updatedAgent);
}
