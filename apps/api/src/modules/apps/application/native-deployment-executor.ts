/**
 * Mosoo Native Deployment Protocol v1 — executor branch (Phase 1).
 *
 * Single source of truth: docs/prd/mosoo-native-deployment-protocol.md
 * (Deployment Semantics). Repos carrying the protocol marker take this branch
 * instead of the legacy detector: validate (Phase 0) → persist the validate
 * report → provision every repo agent with auto-publish → resolve agent
 * capability env vars → hand a worker plan back for the ordinary web chain,
 * or complete agent-only runs directly with no live URL. A protocol repo
 * never falls back to generic detection.
 *
 * Failure discipline (hard rule): no throw escapes this branch. Every failure
 * terminal-fails the run through `failDeploymentRunIfActive` with a stable
 * code — `native_*` codes from the closed contract set, the legacy detection
 * codes for [expose.web] host-shape problems, and the existing lost-run codes
 * for CAS races — so the queue's exception-name fallback never reaches
 * `run.errorCode`, and no return path leaves the run wedged in the unique
 * active-run index (a CAS `false` already proves the run left the active
 * set).
 */
import { NATIVE_TOML_PATH } from "@mosoo/contracts/native-deployment";
import type { NativeValidateFacts, NativeValidateResult } from "@mosoo/contracts/native-deployment";
import { serializeNativeDeploymentRunResult } from "@mosoo/contracts/native-deployment-run";
import type {
  NativeDeploymentRunFacts,
  NativeDeploymentRunResult,
} from "@mosoo/contracts/native-deployment-run";
import { appDeploymentRunsTable } from "@mosoo/db";
import type { AppDeploymentRunId } from "@mosoo/id";
import { and, eq, inArray } from "drizzle-orm";
import { parse as parseToml } from "smol-toml";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase, getD1ChangeCount } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { upsertNativeRepoAgents } from "../../agents/application/agent-native-repo-upsert.service";
import type { NativeRepoAgentUpsertResult } from "../../agents/application/agent-native-repo-upsert.service";
import { loadViewerByAccountId } from "../../auth/application/viewer-auth.service";
import { ACTIVE_APP_DEPLOYMENT_RUN_STATUSES } from "../domain/app-deployment-lifecycle";
import { AppAgentBindingResolutionError } from "./app-agent-binding-resolution";
import { AppDeploymentDetectionError, detectAppDeploymentPlan } from "./app-deployment-detector";
import type {
  AppDeploymentDetectionErrorCode,
  AppDeploymentPlan,
  AppDeploymentRepositorySnapshot,
} from "./app-deployment-detector";
import {
  completeDeploymentRun,
  failDeploymentRunIfActive,
  resolveDeploymentEnvVars,
  storeDeploymentPlan,
} from "./app-deployment-run-steps";
import type {
  AppDeploymentDispatchContext,
  PreparedAppDeploymentRepository,
} from "./app-deployment-run-steps";
import { ensureAppSlug } from "./app-slug.service";
import { validateNativeDeployment } from "./native-deployment-validator";

/** Env var carrying the bound-agent capability URL into an [expose.web] host. */
const NATIVE_WEB_AGENT_ENV = "MOSOO_AGENT_URL";

export type NativeDeploymentBranchOutcome =
  | { envVars: Record<string, string>; kind: "deploy_web"; plan: AppDeploymentPlan }
  | { kind: "handled" };

/**
 * Protocol detection boundary (PRD Open Decision 3): a repo is native iff its
 * root `.mosoo.toml` parses to a table with a top-level `spec` key, or fails
 * to parse but visibly declares `spec =`. A legacy schema=1 `.mosoo.toml`
 * (no `spec`) keeps the legacy detector; an unparseable marker that declares
 * `spec =` is a protocol authoring error and must reach the native validator
 * (native.toml.parse_error) instead of the legacy TOML error.
 */
export function isNativeDeploymentRepo(snapshot: AppDeploymentRepositorySnapshot): boolean {
  const source = snapshot.files[NATIVE_TOML_PATH];

  if (source === undefined) {
    return false;
  }

  let parsed: unknown;

  try {
    parsed = parseToml(source);
  } catch {
    return /^\s*spec\s*=/mu.test(source);
  }

  return isRecord(parsed) && parsed["spec"] !== undefined;
}

/**
 * Runs the native prelude on a prepared repository: validate, persist the
 * result JSON, build the native plan, upsert + auto-publish repo agents, and
 * resolve capability env vars. Returns `deploy_web` with the worker plan and
 * env vars when the repo declares [expose.web] (the caller continues the
 * ordinary build→deploy→complete chain), or `handled` when the run reached a
 * terminal state here (agent-only success, any failure, or a lost CAS race).
 */
export async function runNativeDeploymentBranch(
  bindings: ApiBindings,
  input: {
    context: AppDeploymentDispatchContext;
    prepared: PreparedAppDeploymentRepository;
    targetName: string;
  },
): Promise<NativeDeploymentBranchOutcome> {
  try {
    return await runNativeDeploymentBranchUnsafe(bindings, input);
  } catch (error) {
    await failDeploymentRunIfActive({
      database: bindings.DB,
      errorCode: "native_provision_failed",
      errorMessage: `Native deployment failed: ${errorMessage(error)}`,
      runId: input.context.run.id,
    });
    return { kind: "handled" };
  }
}

async function runNativeDeploymentBranchUnsafe(
  bindings: ApiBindings,
  input: {
    context: AppDeploymentDispatchContext;
    prepared: PreparedAppDeploymentRepository;
    targetName: string;
  },
): Promise<NativeDeploymentBranchOutcome> {
  const { deployment, run } = input.context;
  const database = bindings.DB;
  const validate = validateNativeDeployment(input.prepared.snapshot);

  // The validate report is persisted immediately (facts arrive after the
  // upsert step) so the console failure expansion always has repo-term
  // diagnostics, even for runs that die in a later step.
  if (!(await persistNativeDeploymentRunResult(database, run.id, { facts: null, validate }))) {
    return { kind: "handled" };
  }

  const validateFacts = validate.facts;

  if (!validate.valid || validateFacts === null) {
    await failDeploymentRunIfActive({
      database,
      errorCode: "native_validation_failed",
      errorMessage: nativeValidationFailureMessage(validate),
      runId: run.id,
    });
    return { kind: "handled" };
  }

  // First green-validated protocol deploy mints the App's namespace slug
  // from the App name; later deploys read the immutable value back. A mint
  // failure throws into the branch catch-all (native_provision_failed).
  await ensureAppSlug(database, deployment.appId);

  const planOutcome = buildNativeDeploymentPlan(
    input.prepared.snapshot,
    validateFacts,
    input.targetName,
  );

  if (planOutcome.kind === "web_static_unsupported") {
    await failDeploymentRunIfActive({
      database,
      errorCode: "native_web_static_unsupported",
      errorMessage: planOutcome.message,
      runId: run.id,
    });
    return { kind: "handled" };
  }

  if (planOutcome.kind === "web_detection_failed") {
    await failDeploymentRunIfActive({
      database,
      errorCode: planOutcome.code,
      errorMessage: planOutcome.message,
      runId: run.id,
    });
    return { kind: "handled" };
  }

  const plan = planOutcome.plan;

  if (
    !(await storeDeploymentPlan({
      database,
      plan,
      runId: run.id,
      targetName: input.targetName,
    }))
  ) {
    return { kind: "handled" };
  }

  const viewer = await loadViewerByAccountId(database, deployment.ownerAccountId);

  if (viewer === null) {
    await failDeploymentRunIfActive({
      database,
      errorCode: "native_provision_failed",
      errorMessage: "The deployment owner account no longer exists.",
      runId: run.id,
    });
    return { kind: "handled" };
  }

  const upsert = await upsertNativeRepoAgents(bindings, viewer, {
    agents: validateFacts.agents,
    appId: deployment.appId,
    files: input.prepared.snapshot.files,
    sourceCommitSha: run.sourceCommitSha,
  });

  // Per-agent outcomes are persisted before any terminal transition: the
  // result CAS only writes while the run is still in the active set.
  await persistNativeDeploymentRunResult(database, run.id, {
    facts: buildNativeDeploymentRunFacts(validateFacts, upsert.results),
    validate,
  });

  if (upsert.blocking !== undefined) {
    await failDeploymentRunIfActive({
      database,
      errorCode: upsert.blocking.code,
      errorMessage: upsert.blocking.message,
      runId: run.id,
    });
    return { kind: "handled" };
  }

  let envVars: Record<string, string>;

  try {
    envVars = await resolveDeploymentEnvVars(bindings, deployment, plan);
  } catch (error) {
    // Bindings resolve against the rows this very run just upserted and
    // published, so this is a defensive backstop rather than a live path.
    if (error instanceof AppAgentBindingResolutionError) {
      await failDeploymentRunIfActive({
        database,
        errorCode: error.code,
        errorMessage: error.message,
        runId: run.id,
      });
      return { kind: "handled" };
    }

    throw error;
  }

  if (plan.targetKind !== "agent_only") {
    return { envVars, kind: "deploy_web", plan };
  }

  // Agent-only repos have nothing to build or deploy: the provisioned agent
  // endpoints are the deliverable, so the run completes with no live URL.
  const completed = await completeDeploymentRun({
    database,
    deployment,
    result: {
      externalDeploymentId: null,
      externalProjectId: null,
      externalVersionId: null,
      url: null,
    },
    run,
  });

  if (!completed) {
    await failDeploymentRunIfActive({
      database,
      errorCode: "deployment_completion_lost",
      errorMessage: "Agents were provisioned but the App deployment row changed.",
      runId: run.id,
    });
  }

  return { kind: "handled" };
}

type NativeDeploymentPlanOutcome =
  | { code: AppDeploymentDetectionErrorCode; kind: "web_detection_failed"; message: string }
  | { kind: "plan"; plan: AppDeploymentPlan }
  | { kind: "web_static_unsupported"; message: string };

/**
 * Builds the deployment plan for a green-validated protocol repo. Without
 * [expose.web] the plan is agent-only (nothing to build or deploy). With
 * [expose.web] the host shape comes from the existing repo detector run with
 * the protocol marker removed — the legacy `.mosoo.toml` schema rejects
 * protocol keys, and on the protocol path the marker owns exposure, not host
 * detection. Only worker-shaped hosts are deployable: capability env var
 * injection has no static-assets story (worker-only precedent in the legacy
 * detector), so a static shape is a stable `native_web_static_unsupported`.
 */
function buildNativeDeploymentPlan(
  snapshot: AppDeploymentRepositorySnapshot,
  facts: NativeValidateFacts,
  resourceName: string,
): NativeDeploymentPlanOutcome {
  if (!facts.web.declared) {
    return { kind: "plan", plan: agentOnlyDeploymentPlan() };
  }

  const files: Record<string, string> = { ...snapshot.files };
  delete files[NATIVE_TOML_PATH];

  let plan: AppDeploymentPlan;

  try {
    plan = detectAppDeploymentPlan({ files }, { resourceName });
  } catch (error) {
    if (error instanceof AppDeploymentDetectionError) {
      return {
        code: error.code,
        kind: "web_detection_failed",
        message: `[expose.web] needs a deployable web app: ${error.message}`,
      };
    }

    throw error;
  }

  if (plan.targetKind !== "cloudflare_worker") {
    return {
      kind: "web_static_unsupported",
      message:
        "[expose.web] requires a Worker-shaped web app; static asset deployments cannot receive the agent capability URL. Add a Worker entry or remove [expose.web].",
    };
  }

  // planJson.agentBindings stays populated for the App overview's bound-agent
  // card (dual consumer of the stored plan).
  const webAgent = facts.web.agent;

  return {
    kind: "plan",
    plan: {
      ...plan,
      agentBindings:
        webAgent === undefined
          ? []
          : [{ env: NATIVE_WEB_AGENT_ENV, expose: "public_thread", name: webAgent }],
      mosooConfigPath: NATIVE_TOML_PATH,
    },
  };
}

function agentOnlyDeploymentPlan(): AppDeploymentPlan {
  return {
    agentBindings: [],
    buildCommand: null,
    generatedWranglerConfig: "",
    installCommand: null,
    mosooConfigPath: NATIVE_TOML_PATH,
    outputDir: null,
    packageManager: "none",
    routesFallback: null,
    rootDir: ".",
    targetKind: "agent_only",
    targetMode: "agent_only",
    warnings: [],
    workerEntry: null,
  };
}

function buildNativeDeploymentRunFacts(
  facts: NativeValidateFacts,
  results: readonly NativeRepoAgentUpsertResult[],
): NativeDeploymentRunFacts {
  const exposedByName = new Map(facts.agents.map((agent) => [agent.name, agent.exposed]));

  return {
    agentCount: facts.agentCount,
    agents: results.map((result) => ({
      action: result.action,
      exposed: exposedByName.get(result.name) ?? false,
      name: result.name,
      ...(result.versionNumber === undefined ? {} : { versionNumber: result.versionNumber }),
    })),
    specVersion: facts.spec,
    web: {
      ...(facts.web.agent === undefined ? {} : { agent: facts.web.agent }),
      declared: facts.web.declared,
    },
  };
}

async function persistNativeDeploymentRunResult(
  database: D1Database,
  runId: AppDeploymentRunId,
  result: NativeDeploymentRunResult,
): Promise<boolean> {
  const update = await getAppDatabase(database)
    .update(appDeploymentRunsTable)
    .set({
      nativeResultJson: serializeNativeDeploymentRunResult(result),
      updatedAt: currentTimestampMs(),
    })
    .where(
      and(
        eq(appDeploymentRunsTable.id, runId),
        inArray(appDeploymentRunsTable.status, ACTIVE_APP_DEPLOYMENT_RUN_STATUSES),
      ),
    )
    .run();

  return getD1ChangeCount(update) > 0;
}

function nativeValidationFailureMessage(validate: NativeValidateResult): string {
  const problems = validate.failures
    .filter((failure) => failure.severity === "error")
    .map((failure) => `${failure.file}: ${failure.problem}`);

  if (problems.length === 0) {
    return "Repository failed native validation.";
  }

  const shown = problems.slice(0, 3).join(" ");
  const suffix = problems.length > 3 ? ` (+${problems.length - 3} more)` : "";

  return `Repository failed native validation. ${shown}${suffix}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
