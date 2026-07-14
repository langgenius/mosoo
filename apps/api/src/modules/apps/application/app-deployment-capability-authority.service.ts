import { agentsTable, appDeploymentRunsTable, appDeploymentsTable } from "@mosoo/db";
import type { AgentId, AppDeploymentId, AppDeploymentRunId, AppId } from "@mosoo/id";
import { and, desc, eq, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

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

export type DeploymentAgentCapabilityAuthorityRejection =
  | "binding_removed"
  | "deployment_deleted"
  | "deployment_not_activated"
  | "deployment_not_found"
  | "deployment_plan_invalid"
  | "deployment_revision_replaced";

export type DeploymentAgentCapabilityAuthorityResult =
  | { authorized: true }
  | { authorized: false; reason: DeploymentAgentCapabilityAuthorityRejection };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsBoundAgentBinding(
  planJson: string,
  binding: DeploymentAgentCapabilityAuthority["binding"],
): "absent" | "invalid" | "present" {
  try {
    const plan = JSON.parse(planJson);

    if (!isRecord(plan) || !Array.isArray(plan["agentBindings"])) {
      return "invalid";
    }

    return plan["agentBindings"].some(
      (candidate) =>
        isRecord(candidate) &&
        candidate["env"] === binding.env &&
        candidate["expose"] === binding.expose &&
        candidate["name"] === binding.name,
    )
      ? "present"
      : "absent";
  } catch {
    return "invalid";
  }
}

/**
 * Verifies that a bound capability still belongs to the active Deployment and
 * its latest successful binding revision. Failed deployment attempts leave the
 * previous successful revision authoritative.
 */
export async function getDeploymentAgentCapabilityAuthority(
  database: D1Database,
  input: DeploymentAgentCapabilityAuthority,
): Promise<DeploymentAgentCapabilityAuthorityResult> {
  const deployment =
    (await getAppDatabase(database)
      .select({
        deletedAt: appDeploymentsTable.deletedAt,
        id: appDeploymentsTable.id,
      })
      .from(appDeploymentsTable)
      .where(
        and(
          eq(appDeploymentsTable.id, input.deploymentId),
          eq(appDeploymentsTable.appId, input.appId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (deployment === null) {
    return { authorized: false, reason: "deployment_not_found" };
  }

  if (deployment.deletedAt !== null) {
    return { authorized: false, reason: "deployment_deleted" };
  }

  const currentSuccessfulRun =
    (await getAppDatabase(database)
      .select({
        id: appDeploymentRunsTable.id,
        planJson: appDeploymentRunsTable.planJson,
      })
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

  if (currentSuccessfulRun === null) {
    return { authorized: false, reason: "deployment_not_activated" };
  }

  if (currentSuccessfulRun.planJson === null) {
    return { authorized: false, reason: "deployment_plan_invalid" };
  }

  const binding = containsBoundAgentBinding(currentSuccessfulRun.planJson, input.binding);

  if (binding === "invalid") {
    return { authorized: false, reason: "deployment_plan_invalid" };
  }

  if (currentSuccessfulRun.id !== input.deploymentRunId) {
    return {
      authorized: false,
      reason: binding === "present" ? "deployment_revision_replaced" : "binding_removed",
    };
  }

  return binding === "present"
    ? { authorized: true }
    : { authorized: false, reason: "binding_removed" };
}

/**
 * Adds the same revocation boundary to the statement that inserts a billable
 * Run. The earlier read gives useful rejection reasons; this condition closes
 * the race where deletion or a successful replacement commits before the Run
 * insert. The already-verified binding plan is immutable once its run is
 * successful, so the current successful run ID is the revision fence here.
 */
export function createDeploymentAgentCapabilityRunCreationGuard(
  input: DeploymentAgentCapabilityAuthority & { agentId: AgentId },
): SQL {
  return sql`
    EXISTS (
      SELECT 1
      FROM ${appDeploymentsTable}
      INNER JOIN ${agentsTable}
        ON ${agentsTable.id} = ${input.agentId}
      WHERE ${appDeploymentsTable.id} = ${input.deploymentId}
        AND ${appDeploymentsTable.appId} = ${input.appId}
        AND ${appDeploymentsTable.deletedAt} IS NULL
        AND ${agentsTable.appId} = ${input.appId}
        AND ${agentsTable.name} = ${input.binding.name}
        AND ${agentsTable.status} = 'published'
        AND ${agentsTable.liveDeploymentVersionId} IS NOT NULL
        AND ${input.deploymentRunId} = (
          SELECT ${appDeploymentRunsTable.id}
          FROM ${appDeploymentRunsTable}
          WHERE ${appDeploymentRunsTable.appId} = ${input.appId}
            AND ${appDeploymentRunsTable.deploymentId} = ${input.deploymentId}
            AND ${appDeploymentRunsTable.status} = 'success'
          ORDER BY ${appDeploymentRunsTable.id} DESC
          LIMIT 1
        )
    )
  `;
}
