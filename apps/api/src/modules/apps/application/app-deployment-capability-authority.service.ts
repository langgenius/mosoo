import { appDeploymentRunsTable, appDeploymentsTable } from "@mosoo/db";
import type { AppDeploymentId, AppDeploymentRunId, AppId } from "@mosoo/id";
import { and, desc, eq, isNull } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";

interface DeploymentAgentCapabilityAuthority {
  appId: AppId;
  binding: {
    env: string;
    expose: "public_thread";
    name: string;
  };
  deploymentId: AppDeploymentId;
  deploymentRunId: AppDeploymentRunId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsBoundAgentBinding(
  planJson: string,
  binding: DeploymentAgentCapabilityAuthority["binding"],
): boolean {
  try {
    const plan = JSON.parse(planJson);

    if (!isRecord(plan) || !Array.isArray(plan["agentBindings"])) {
      return false;
    }

    return plan["agentBindings"].some(
      (candidate) =>
        isRecord(candidate) &&
        candidate["env"] === binding.env &&
        candidate["expose"] === binding.expose &&
        candidate["name"] === binding.name,
    );
  } catch {
    return false;
  }
}

/**
 * Verifies that a bound capability still belongs to the active Deployment and
 * its latest successful binding revision. Failed deployment attempts leave the
 * previous successful revision authoritative.
 */
export async function isCurrentDeploymentAgentCapability(
  database: D1Database,
  input: DeploymentAgentCapabilityAuthority,
): Promise<boolean> {
  const deployment =
    (await getAppDatabase(database)
      .select({ id: appDeploymentsTable.id })
      .from(appDeploymentsTable)
      .where(
        and(
          eq(appDeploymentsTable.id, input.deploymentId),
          eq(appDeploymentsTable.appId, input.appId),
          isNull(appDeploymentsTable.deletedAt),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (deployment === null) {
    return false;
  }

  const currentSuccessfulRun =
    (await getAppDatabase(database)
      .select({ id: appDeploymentRunsTable.id, planJson: appDeploymentRunsTable.planJson })
      .from(appDeploymentRunsTable)
      .where(
        and(
          eq(appDeploymentRunsTable.appId, input.appId),
          eq(appDeploymentRunsTable.deploymentId, input.deploymentId),
          eq(appDeploymentRunsTable.status, "success"),
        ),
      )
      .orderBy(desc(appDeploymentRunsTable.id))
      .limit(1)
      .get()) ?? null;

  return (
    currentSuccessfulRun !== null &&
    currentSuccessfulRun.id === input.deploymentRunId &&
    currentSuccessfulRun.planJson !== null &&
    containsBoundAgentBinding(currentSuccessfulRun.planJson, input.binding)
  );
}
