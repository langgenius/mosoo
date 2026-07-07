/**
 * Shared App deployment run-row steps: dispatch-context reads, CAS status
 * walks, plan/terminal persistence, and agent-binding env var resolution.
 * Both deployment executors — the legacy detector path in
 * `app-deployment-executor.service.ts` and the native protocol branch in
 * `native-deployment-executor.ts` — drive runs through these helpers; they
 * live outside either executor to keep the import graph acyclic.
 *
 * Every run-row write CASes on {@link ACTIVE_APP_DEPLOYMENT_RUN_STATUSES}:
 * a `false` return means the run left the active set concurrently (terminal
 * or superseded), never that it is still active, so callers may return
 * without wedging the unique active-run index.
 */
import type { AppDeploymentRunStatus } from "@mosoo/contracts/app";
import type { AppDeploymentRunRow, AppDeploymentRow } from "@mosoo/db";
import { appDeploymentRunsTable, appDeploymentsTable } from "@mosoo/db";
import type { AppDeploymentRunId } from "@mosoo/id";
import { and, eq, inArray, isNull } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase, getD1ChangeCount } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { listAppOwnerAgentRows } from "../../agents/application/agent-repository";
import { boundAgentUrl, mintAppAgentCapabilityToken } from "../../public-api/app-agent-capability";
import { ACTIVE_APP_DEPLOYMENT_RUN_STATUSES } from "../domain/app-deployment-lifecycle";
import { resolveAppAgentBindings } from "./app-agent-binding-resolution";
import type { ResolvableAppAgent } from "./app-agent-binding-resolution";
import type { AppDeploymentPlan, AppDeploymentRepositorySnapshot } from "./app-deployment-detector";

export interface AppDeploymentDispatchContext {
  deployment: AppDeploymentRow;
  run: AppDeploymentRunRow;
}

export interface PreparedAppDeploymentRepository {
  repoDir: string;
  snapshot: AppDeploymentRepositorySnapshot;
}

/** Result of an external deploy; the runner always produces a live URL. */
export interface AppDeploymentDeployResult {
  externalDeploymentId: string | null;
  externalProjectId: string | null;
  externalVersionId: string | null;
  url: string;
}

/**
 * Terminal completion payload. `url` is null only for agent-only protocol
 * runs, which have no web deployment; every web path completes with the
 * runner's deploy result and therefore a concrete URL.
 */
export interface AppDeploymentCompletionResult {
  externalDeploymentId: string | null;
  externalProjectId: string | null;
  externalVersionId: string | null;
  url: string | null;
}

function isActiveRunStatus(status: AppDeploymentRunStatus): boolean {
  return (ACTIVE_APP_DEPLOYMENT_RUN_STATUSES as readonly AppDeploymentRunStatus[]).includes(status);
}

export async function readCurrentDispatchContext(
  database: D1Database,
  runId: AppDeploymentRunId,
): Promise<AppDeploymentDispatchContext | null> {
  const run =
    (await getAppDatabase(database)
      .select()
      .from(appDeploymentRunsTable)
      .where(eq(appDeploymentRunsTable.id, runId))
      .limit(1)
      .get()) ?? null;

  if (run === null || !isActiveRunStatus(run.status)) {
    return null;
  }

  const deployment =
    (await getAppDatabase(database)
      .select()
      .from(appDeploymentsTable)
      .where(
        and(
          eq(appDeploymentsTable.id, run.deploymentId),
          eq(appDeploymentsTable.latestRunId, run.id),
          isNull(appDeploymentsTable.deletedAt),
        ),
      )
      .limit(1)
      .get()) ?? null;

  return deployment === null ? null : { deployment, run };
}

export async function updateRunStatus(
  database: D1Database,
  runId: AppDeploymentRunId,
  status: Extract<
    AppDeploymentRunStatus,
    "activating" | "building" | "preparing" | "submitted" | "submitting"
  >,
): Promise<boolean> {
  const result = await getAppDatabase(database)
    .update(appDeploymentRunsTable)
    .set({ status, updatedAt: currentTimestampMs() })
    .where(
      and(
        eq(appDeploymentRunsTable.id, runId),
        inArray(appDeploymentRunsTable.status, ACTIVE_APP_DEPLOYMENT_RUN_STATUSES),
      ),
    )
    .run();

  return getD1ChangeCount(result) > 0;
}

export async function storeDeploymentPlan(input: {
  database: D1Database;
  plan: AppDeploymentPlan;
  runId: AppDeploymentRunId;
  targetName: string;
}): Promise<boolean> {
  const planTargetKind = input.plan.targetKind;
  // `agent_only` is a plan-level target: the run row's target_kind column is
  // CHECK-constrained to the two Cloudflare kinds, so agent-only runs keep
  // the column NULL and carry the kind in plan_json (and native facts).
  const targetKind = planTargetKind === "agent_only" ? null : planTargetKind;
  const result = await getAppDatabase(input.database)
    .update(appDeploymentRunsTable)
    .set({
      generatedWranglerConfigJson: JSON.stringify({ toml: input.plan.generatedWranglerConfig }),
      planJson: JSON.stringify(input.plan),
      targetKind,
      targetProjectName: planTargetKind === "cloudflare_pages" ? input.targetName : null,
      targetScriptName: planTargetKind === "cloudflare_worker" ? input.targetName : null,
      updatedAt: currentTimestampMs(),
    })
    .where(
      and(
        eq(appDeploymentRunsTable.id, input.runId),
        inArray(appDeploymentRunsTable.status, ACTIVE_APP_DEPLOYMENT_RUN_STATUSES),
      ),
    )
    .run();

  return getD1ChangeCount(result) > 0;
}

export async function failDeploymentRunIfActive(input: {
  database: D1Database;
  errorCode: string;
  errorMessage: string;
  runId: AppDeploymentRunId;
}): Promise<void> {
  await getAppDatabase(input.database)
    .update(appDeploymentRunsTable)
    .set({
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      status: "failed",
      updatedAt: currentTimestampMs(),
    })
    .where(
      and(
        eq(appDeploymentRunsTable.id, input.runId),
        inArray(appDeploymentRunsTable.status, ACTIVE_APP_DEPLOYMENT_RUN_STATUSES),
      ),
    )
    .run();
}

export async function completeDeploymentRun(input: {
  database: D1Database;
  deployment: AppDeploymentRow;
  result: AppDeploymentCompletionResult;
  run: AppDeploymentRunRow;
}): Promise<boolean> {
  const nowMs = currentTimestampMs();
  const deploymentUpdate = await getAppDatabase(input.database)
    .update(appDeploymentsTable)
    .set({
      lastSuccessfulUrl: input.result.url,
      updatedAt: nowMs,
    })
    .where(
      and(
        eq(appDeploymentsTable.id, input.deployment.id),
        eq(appDeploymentsTable.latestRunId, input.run.id),
        isNull(appDeploymentsTable.deletedAt),
      ),
    )
    .run();

  if (getD1ChangeCount(deploymentUpdate) === 0) {
    return false;
  }

  const runUpdate = await getAppDatabase(input.database)
    .update(appDeploymentRunsTable)
    .set({
      errorCode: null,
      errorMessage: null,
      externalDeploymentId: input.result.externalDeploymentId,
      externalProjectId: input.result.externalProjectId,
      externalVersionId: input.result.externalVersionId,
      status: "success",
      updatedAt: nowMs,
      url: input.result.url,
    })
    .where(
      and(
        eq(appDeploymentRunsTable.id, input.run.id),
        inArray(appDeploymentRunsTable.status, ACTIVE_APP_DEPLOYMENT_RUN_STATUSES),
      ),
    )
    .run();

  return getD1ChangeCount(runUpdate) > 0;
}

// Long-lived: the injected URL lives with the deployed Worker and is revoked by
// deleting the deployment (which destroys the Worker) plus the ask endpoint's
// re-check that the agent is still published. See docs/prd/app-deployment.md.
const APP_AGENT_CAPABILITY_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000;

// Resolve `.mosoo.toml [[agents]]` bindings to published agents and mint one
// self-authorizing capability URL per binding (fail-fast on an unpublished or
// missing agent). Returns the env var map injected into the deployed Worker.
export async function resolveDeploymentEnvVars(
  bindings: ApiBindings,
  deployment: AppDeploymentRow,
  plan: AppDeploymentPlan,
): Promise<Record<string, string>> {
  if (plan.agentBindings.length === 0) {
    return {};
  }

  const agentRows = await listAppOwnerAgentRows(bindings.DB, {
    appId: deployment.appId,
    viewerId: deployment.ownerAccountId,
  });
  const resolvable: ResolvableAppAgent[] = agentRows.map((agent) => ({
    id: agent.id,
    name: agent.name,
    published: agent.status === "published" && agent.liveDeploymentVersionId !== null,
  }));
  const resolved = resolveAppAgentBindings(plan.agentBindings, resolvable);
  const expiresAtMs = currentTimestampMs() + APP_AGENT_CAPABILITY_TTL_MS;
  const envVars: Record<string, string> = {};

  for (const binding of resolved) {
    const token = await mintAppAgentCapabilityToken(bindings.RUNTIME_ACTION_TOKEN_SECRET, {
      agentId: binding.agentId,
      appId: deployment.appId,
      exp: expiresAtMs,
      expose: binding.expose,
    });
    envVars[binding.envVar] = boundAgentUrl(bindings.WEB_ORIGIN, token);
  }

  return envVars;
}
