import type { Agent, DeleteAgentInput, PublishAgentInput } from "@mosoo/contracts/agent";
import {
  agentDeploymentVersionsTable,
  agentSkillsTable,
  agentSpaceBindingsTable,
  agentsTable,
} from "@mosoo/db";
import type { AgentId, AppId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase, runAppDatabaseBatch } from "../../../platform/db/drizzle";
import { validationError } from "../../../platform/errors";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { removeAllAgentMcpBindings } from "../../mcp/application/mcp-agent-binding.service";
import { ensureAppAgentOwner } from "./agent-access.service";
import { prepareAgentDeploymentVersionCandidate } from "./agent-deployment-version.service";
import { loadAgentEnvironmentConfig } from "./agent-environment.service";
import { toAgentModel } from "./agent-models";
import { readAgentId, readAppId } from "./agent-platform-ids";
import { computeAgentReadiness } from "./agent-readiness.service";
import { getAgentRow } from "./agent-repository";
import { buildAgentSpec } from "./agent-spec.service";
import { parseAgentStoredConfig } from "./agent-stored-config.service";
export async function deleteAgent(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: DeleteAgentInput,
): Promise<void> {
  const { agent } = await ensureAppAgentOwner(database, viewer.id, {
    agentId: readAgentId(input.agentId),
    appId: readAppId(input.appId),
  });

  await removeAllAgentMcpBindings(database, agent.id);

  await runAppDatabaseBatch(database, (db) => [
    db.delete(agentSkillsTable).where(eq(agentSkillsTable.agentId, agent.id)),
    db.delete(agentSpaceBindingsTable).where(eq(agentSpaceBindingsTable.agentId, agent.id)),
    db.delete(agentsTable).where(eq(agentsTable.id, agent.id)),
  ]);
}

export async function publishAgent(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: PublishAgentInput,
): Promise<Agent> {
  const database = bindings.DB;
  const { agent } = await ensureAppAgentOwner(database, viewer.id, {
    agentId: readAgentId(input.agentId),
    appId: readAppId(input.appId),
  });
  const environment = await loadAgentEnvironmentConfig(database, agent.id, agent.environmentId);
  const { packageResolution } = parseAgentStoredConfig(agent.configJson);
  const readiness = await computeAgentReadiness(database, agent.ownerId, {
    agentId: agent.id,
    bindings,
    environment,
    model: agent.model,
    organizationId: agent.organizationId,
    packageResolution,
    appId: agent.appId,
    provider: agent.provider,
    runtimeId: agent.runtimeId,
  });

  // Re-publish inherits the agent's current visibility when input omits it.
  // First publish either receives an explicit value or falls through to the
  // DB default ("private"), so we always have a concrete visibility.
  const targetVisibility = input.visibility ?? agent.visibility;

  if (targetVisibility !== "private") {
    throw validationError(
      "Organization-wide Agent publishing is not supported for App-scoped Apps.",
      "AGENT_PUBLISH_ORG_VISIBILITY_DISABLED",
    );
  }

  if (!readiness.ready) {
    throw validationError(
      `Agent is not ready to publish: ${readiness.issues.map((issue) => issue.message).join(" ")}`,
      "AGENT_PUBLISH_NOT_READY",
    );
  }

  const timestampMs = currentTimestampMs();
  const spec = await buildAgentSpec(database, agent);
  const version = await prepareAgentDeploymentVersionCandidate(database, viewer, {
    agent,
    spec,
    summary: isTruthy(agent.liveDeploymentVersionId) ? "Re-publish" : "Initial publish",
    timestampMs,
  });

  await runAppDatabaseBatch(database, (db) => [
    db.insert(agentDeploymentVersionsTable).values(version.values),
    db
      .update(agentsTable)
      .set({
        liveDeploymentVersionId: version.record.id,
        status: "published",
        updatedAt: timestampMs,
        visibility: targetVisibility,
      })
      .where(eq(agentsTable.id, agent.id)),
  ]);

  return toAgentModel(database, viewer, await getAgentRow(database, agent.id));
}

export async function unpublishAgent(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: {
    agentId: AgentId;
    appId: AppId;
  },
): Promise<Agent> {
  const { agent } = await ensureAppAgentOwner(database, viewer.id, input);
  const timestampMs = currentTimestampMs();

  await getAppDatabase(database)
    .update(agentsTable)
    .set({ status: "draft", updatedAt: timestampMs })
    .where(eq(agentsTable.id, agent.id))
    .run();

  return toAgentModel(database, viewer, await getAgentRow(database, agent.id));
}
