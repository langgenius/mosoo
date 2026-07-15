import { sessionRunsTable } from "@mosoo/db";
import type { AgentId, AppDeploymentId, AppDeploymentRunId, AppId, SessionRunId } from "@mosoo/id";
import { and, eq } from "drizzle-orm";

import { getAppDatabase } from "../../platform/db/drizzle";
import { ensureAppOwnership } from "../apps/application/app.service";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";

export interface BoundCapabilityRunProvenanceRecord {
  agentId: AgentId;
  appId: AppId;
  bindingEnv: string;
  bindingName: string;
  deploymentId: AppDeploymentId;
  deploymentRunId: AppDeploymentRunId;
  runId: SessionRunId;
}

/**
 * Returns the immutable, non-secret delegation facts for a Run. App ownership
 * is intentionally required because deployment identifiers and binding names
 * are operational audit data, not part of the public Thread response.
 */
export async function getBoundCapabilityRunProvenance(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: { appId: AppId; runId: SessionRunId },
): Promise<BoundCapabilityRunProvenanceRecord | null> {
  await ensureAppOwnership(database, viewer.id, input.appId);

  const row =
    (await getAppDatabase(database)
      .select({
        agentId: sessionRunsTable.boundCapabilityAgentId,
        appId: sessionRunsTable.boundCapabilityAppId,
        bindingEnv: sessionRunsTable.boundCapabilityBindingEnv,
        bindingName: sessionRunsTable.boundCapabilityBindingName,
        deploymentId: sessionRunsTable.boundCapabilityDeploymentId,
        deploymentRunId: sessionRunsTable.boundCapabilityDeploymentRunId,
        runId: sessionRunsTable.id,
      })
      .from(sessionRunsTable)
      .where(
        and(
          eq(sessionRunsTable.id, input.runId),
          eq(sessionRunsTable.boundCapabilityAppId, input.appId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (row === null) {
    return null;
  }

  if (
    row.agentId === null ||
    row.appId === null ||
    row.bindingEnv === null ||
    row.bindingName === null ||
    row.deploymentId === null ||
    row.deploymentRunId === null
  ) {
    throw new Error("Bound capability Run provenance must be complete when present.");
  }

  return {
    agentId: row.agentId,
    appId: row.appId,
    bindingEnv: row.bindingEnv,
    bindingName: row.bindingName,
    deploymentId: row.deploymentId,
    deploymentRunId: row.deploymentRunId,
    runId: row.runId,
  };
}
