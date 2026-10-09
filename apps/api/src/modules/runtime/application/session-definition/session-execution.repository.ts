import { createDefaultAgentBuiltInTools, normalizeAgentBuiltInTools } from "@mosoo/contracts/agent";
import { sessionExecutionSnapshotsTable } from "@mosoo/db";
import type { SessionId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import { getAppDatabase } from "../../../../platform/db/drizzle";
import type { SessionExecutionPlan } from "./session-execution.types";

// Written only from a typed plan at Session admission. Historical rows may lack
// builtInTools or carry retired keys (binding.kind, recoveryRetentionMs).
export function parseSessionExecutionPlanJson(planJson: string): SessionExecutionPlan {
  const plan = JSON.parse(planJson) as SessionExecutionPlan;
  const { binding, environment } = plan;

  return {
    binding: {
      agentId: binding.agentId,
      deploymentVersionId: binding.deploymentVersionId,
      deploymentVersionNumber: binding.deploymentVersionNumber,
      model: binding.model,
      prompt: binding.prompt,
      provider: binding.provider,
      runtimeId: binding.runtimeId,
    },
    builtInTools: normalizeAgentBuiltInTools(plan.builtInTools ?? createDefaultAgentBuiltInTools()),
    ...(plan.configJson === undefined ? {} : { configJson: plan.configJson }),
    ...(plan.modelProtocol === undefined ? {} : { modelProtocol: plan.modelProtocol }),
    ...(plan.previewRetentionMs === undefined
      ? {}
      : { previewRetentionMs: plan.previewRetentionMs }),
    environment: {
      allowedHostsJson: environment.allowedHostsJson,
      envVarsJson: environment.envVarsJson,
      environmentId: environment.environmentId,
      environmentName: environment.environmentName,
      networkPolicy: environment.networkPolicy,
      packagesJson: environment.packagesJson,
      revisionId: environment.revisionId,
      setupScript: environment.setupScript,
    },
    skills: plan.skills.map((skill) => ({
      resolutionMode: skill.resolutionMode,
      skillId: skill.skillId,
      skillName: skill.skillName,
      snapshotId: skill.snapshotId,
      sortOrder: skill.sortOrder,
    })),
    tools: plan.tools.map((tool) => ({
      agentCredentialId: tool.agentCredentialId,
      credentialMode: tool.credentialMode,
      serverId: tool.serverId,
      sortOrder: tool.sortOrder,
    })),
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
