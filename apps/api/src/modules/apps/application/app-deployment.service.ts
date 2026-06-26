import type {
  AppDeployment,
  AppDeploymentRun,
  DeleteAppDeploymentInput,
  DeployAppInput,
} from "@mosoo/contracts/app";
import type { AppDeploymentRunRow, AppDeploymentRow } from "@mosoo/db";
import { apiCommandsTable, appDeploymentRunsTable, appDeploymentsTable } from "@mosoo/db";
import type { AppDeploymentId, AppDeploymentRunId, AppId } from "@mosoo/id";
import { createPlatformId } from "@mosoo/id";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase, getD1ChangeCount } from "../../../platform/db/drizzle";
import { validationError } from "../../../platform/errors";
import { currentTimestampMs, toIsoString } from "../../../time";
import {
  createAppDeploymentRunDispatchDedupeKey,
  enqueueAppDeploymentRunDispatchCommand,
} from "../../api-command/application/api-command-enqueue";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ACTIVE_APP_DEPLOYMENT_RUN_STATUSES } from "../domain/app-deployment-lifecycle";
import { ensureAppOwnership } from "./app.service";

type AppDeploymentBindings = Pick<
  ApiBindings,
  "API_COMMAND_QUEUE" | "DB" | "MOSOO_APP_DEPLOYMENT_DOMAIN"
>;

interface AppDeploymentServiceOptions {
  fetch?: typeof fetch;
  nowMs?: () => number;
}

type JsonRecord = Record<string, unknown>;

export async function getAppDeployment(
  bindings: Pick<AppDeploymentBindings, "DB" | "MOSOO_APP_DEPLOYMENT_DOMAIN">,
  viewer: AuthenticatedViewer,
  appId: AppId,
): Promise<AppDeployment | null> {
  await ensureAppOwnership(bindings.DB, viewer.id, appId);

  const deployment = await readActiveDeployment(bindings.DB, appId);

  if (deployment === null) {
    return null;
  }

  const latestRun = await readLatestDeploymentRun(bindings.DB, appId);

  return toAppDeployment(deployment, latestRun, bindings.MOSOO_APP_DEPLOYMENT_DOMAIN);
}

export async function getAppDeploymentStatus(
  bindings: Pick<AppDeploymentBindings, "DB" | "MOSOO_APP_DEPLOYMENT_DOMAIN">,
  viewer: AuthenticatedViewer,
  appId: AppId,
): Promise<AppDeploymentRun | null> {
  await ensureAppOwnership(bindings.DB, viewer.id, appId);

  const run = await readLatestDeploymentRun(bindings.DB, appId);

  if (run === null) {
    return null;
  }

  const deployment = await readDeploymentById(bindings.DB, run.deploymentId);

  return toAppDeploymentRun(run, deployment, bindings.MOSOO_APP_DEPLOYMENT_DOMAIN);
}

export async function deployApp(
  bindings: AppDeploymentBindings,
  viewer: AuthenticatedViewer,
  input: DeployAppInput,
  options: AppDeploymentServiceOptions = {},
): Promise<AppDeploymentRun> {
  const configPath = normalizeConfigPath(input.configPath);
  const app = await ensureAppOwnership(bindings.DB, viewer.id, input.appId);
  const repository = await resolveGitHubRepository(
    input.repoUrl,
    options.fetch ?? globalThis.fetch,
  );
  const activeRun = await readActiveDeploymentRun(bindings.DB, input.appId);

  if (activeRun !== null) {
    throw validationError("An App deployment run is already active.");
  }

  const nowMs = options.nowMs?.() ?? currentTimestampMs();
  const existingDeployment = await readActiveDeployment(bindings.DB, input.appId);
  const deployment =
    existingDeployment ??
    ({
      appId: input.appId,
      createdAt: nowMs,
      defaultBranch: repository.defaultBranch,
      deletedAt: null,
      id: createPlatformId<AppDeploymentId>(),
      lastSuccessfulUrl: null,
      latestRunId: null,
      mosooSubdomain: createMosooSubdomain(input.appId),
      ownerAccountId: app.ownerAccountId,
      repoName: repository.repoName,
      repoOwner: repository.repoOwner,
      repoUrl: repository.repoUrl,
      sourceKind: "github_public",
      updatedAt: nowMs,
    } satisfies AppDeploymentRow);
  const runId = createPlatformId<AppDeploymentRunId>();

  if (existingDeployment === null) {
    const insertDeploymentResult = await getAppDatabase(bindings.DB)
      .insert(appDeploymentsTable)
      .values(deployment)
      .onConflictDoNothing()
      .run();

    if (getD1ChangeCount(insertDeploymentResult) === 0) {
      throw validationError("An App deployment is already active.");
    }
  } else {
    await getAppDatabase(bindings.DB)
      .update(appDeploymentsTable)
      .set({
        defaultBranch: repository.defaultBranch,
        repoName: repository.repoName,
        repoOwner: repository.repoOwner,
        repoUrl: repository.repoUrl,
        updatedAt: nowMs,
      })
      .where(eq(appDeploymentsTable.id, deployment.id))
      .run();
  }

  const insertRunResult = await getAppDatabase(bindings.DB)
    .insert(appDeploymentRunsTable)
    .values({
      appId: input.appId,
      createdAt: nowMs,
      deploymentId: deployment.id,
      errorCode: null,
      errorMessage: null,
      externalDeploymentId: null,
      externalProjectId: null,
      externalVersionId: null,
      generatedWranglerConfigJson: null,
      id: runId,
      mosooConfigJson: configPath === null ? null : JSON.stringify({ configPath }),
      planJson: null,
      sourceBranch: repository.defaultBranch,
      sourceCommitSha: repository.sourceCommitSha,
      status: "queued",
      targetKind: null,
      targetProjectName: null,
      targetScriptName: null,
      updatedAt: nowMs,
      url: null,
    })
    .onConflictDoNothing()
    .run();

  if (getD1ChangeCount(insertRunResult) === 0) {
    throw validationError("An App deployment run is already active.");
  }

  let linkRunResult: D1Result;

  try {
    linkRunResult = await getAppDatabase(bindings.DB)
      .update(appDeploymentsTable)
      .set({ latestRunId: runId, updatedAt: nowMs })
      .where(and(eq(appDeploymentsTable.id, deployment.id), isNull(appDeploymentsTable.deletedAt)))
      .run();
  } catch (error) {
    await markDeploymentRunFailed(bindings.DB, runId, "deployment_run_link_failed", error, nowMs);
    throw error;
  }

  if (getD1ChangeCount(linkRunResult) === 0) {
    await markDeploymentRunFailed(
      bindings.DB,
      runId,
      "deployment_deleted",
      new Error("Deployment was deleted before the run was linked."),
      nowMs,
    );
    throw validationError("App deployment was deleted.");
  }

  try {
    await enqueueAppDeploymentRunDispatchCommand(bindings, {
      appDeploymentRunId: runId,
    });
  } catch (error) {
    await markDeploymentRunFailed(bindings.DB, runId, "deployment_queue_failed", error, nowMs);
    throw error;
  }

  const currentDeployment: AppDeploymentRow = {
    ...deployment,
    defaultBranch: repository.defaultBranch,
    latestRunId: runId,
    repoName: repository.repoName,
    repoOwner: repository.repoOwner,
    repoUrl: repository.repoUrl,
    updatedAt: nowMs,
  };
  const run: AppDeploymentRunRow = {
    appId: input.appId,
    createdAt: nowMs,
    deploymentId: deployment.id,
    errorCode: null,
    errorMessage: null,
    externalDeploymentId: null,
    externalProjectId: null,
    externalVersionId: null,
    generatedWranglerConfigJson: null,
    id: runId,
    mosooConfigJson: configPath === null ? null : JSON.stringify({ configPath }),
    planJson: null,
    sourceBranch: repository.defaultBranch,
    sourceCommitSha: repository.sourceCommitSha,
    status: "queued",
    targetKind: null,
    targetProjectName: null,
    targetScriptName: null,
    updatedAt: nowMs,
    url: null,
  };

  return toAppDeploymentRun(run, currentDeployment, bindings.MOSOO_APP_DEPLOYMENT_DOMAIN);
}

export async function deleteAppDeployment(
  bindings: Pick<AppDeploymentBindings, "DB">,
  viewer: AuthenticatedViewer,
  input: DeleteAppDeploymentInput,
): Promise<{ ok: true }> {
  await ensureAppOwnership(bindings.DB, viewer.id, input.appId);

  const deployment = await readActiveDeployment(bindings.DB, input.appId);

  if (deployment === null) {
    return { ok: true };
  }

  const nowMs = currentTimestampMs();

  await getAppDatabase(bindings.DB)
    .update(appDeploymentsTable)
    .set({
      deletedAt: nowMs,
      lastSuccessfulUrl: null,
      updatedAt: nowMs,
    })
    .where(eq(appDeploymentsTable.id, deployment.id))
    .run();

  await getAppDatabase(bindings.DB)
    .update(appDeploymentRunsTable)
    .set({
      errorCode: "deployment_deleted",
      errorMessage: "Deployment was deleted.",
      status: "failed",
      updatedAt: nowMs,
    })
    .where(
      and(
        eq(appDeploymentRunsTable.appId, input.appId),
        inArray(appDeploymentRunsTable.status, ACTIVE_APP_DEPLOYMENT_RUN_STATUSES),
      ),
    )
    .run();

  return { ok: true };
}

async function readActiveDeployment(
  database: D1Database,
  appId: AppId,
): Promise<AppDeploymentRow | null> {
  return (
    (await getAppDatabase(database)
      .select()
      .from(appDeploymentsTable)
      .where(and(eq(appDeploymentsTable.appId, appId), isNull(appDeploymentsTable.deletedAt)))
      .limit(1)
      .get()) ?? null
  );
}

async function readDeploymentById(
  database: D1Database,
  deploymentId: AppDeploymentId,
): Promise<AppDeploymentRow> {
  const row =
    (await getAppDatabase(database)
      .select()
      .from(appDeploymentsTable)
      .where(eq(appDeploymentsTable.id, deploymentId))
      .limit(1)
      .get()) ?? null;

  if (row === null) {
    throw new Error("App deployment row could not be loaded.");
  }

  return row;
}

async function readLatestDeploymentRun(
  database: D1Database,
  appId: AppId,
): Promise<AppDeploymentRunRow | null> {
  return (
    (await getAppDatabase(database)
      .select()
      .from(appDeploymentRunsTable)
      .where(eq(appDeploymentRunsTable.appId, appId))
      .orderBy(desc(appDeploymentRunsTable.id))
      .limit(1)
      .get()) ?? null
  );
}

async function readActiveDeploymentRun(
  database: D1Database,
  appId: AppId,
): Promise<Pick<AppDeploymentRunRow, "id" | "status"> | null> {
  const run =
    (await getAppDatabase(database)
      .select({ id: appDeploymentRunsTable.id, status: appDeploymentRunsTable.status })
      .from(appDeploymentRunsTable)
      .where(
        and(
          eq(appDeploymentRunsTable.appId, appId),
          inArray(appDeploymentRunsTable.status, ACTIVE_APP_DEPLOYMENT_RUN_STATUSES),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (run === null) {
    return null;
  }

  const dispatchCommand =
    (await getAppDatabase(database)
      .select({ id: apiCommandsTable.id })
      .from(apiCommandsTable)
      .where(
        and(
          eq(apiCommandsTable.dedupeKey, createAppDeploymentRunDispatchDedupeKey(run.id)),
          inArray(apiCommandsTable.status, ["queued", "running"]),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (dispatchCommand !== null) {
    return run;
  }

  await markDeploymentRunFailed(
    database,
    run.id,
    "deployment_dispatch_missing",
    new Error("Deployment dispatch command is missing."),
    currentTimestampMs(),
  );

  return null;
}

async function markDeploymentRunFailed(
  database: D1Database,
  runId: AppDeploymentRunId,
  errorCode: string,
  error: unknown,
  nowMs: number,
): Promise<void> {
  await getAppDatabase(database)
    .update(appDeploymentRunsTable)
    .set({
      errorCode,
      errorMessage: error instanceof Error ? error.message : "Deployment queue failed.",
      status: "failed",
      updatedAt: nowMs,
    })
    .where(eq(appDeploymentRunsTable.id, runId))
    .run();
}

function toAppDeployment(
  row: AppDeploymentRow,
  latestRun: AppDeploymentRunRow | null,
  domain: string,
): AppDeployment {
  return {
    appId: row.appId,
    createdAt: toIsoString(row.createdAt),
    defaultBranch: row.defaultBranch,
    id: row.id,
    latestRun: latestRun === null ? null : toAppDeploymentRun(latestRun, row, domain),
    liveUrl: row.lastSuccessfulUrl,
    plannedUrl: createPlannedUrl(row.mosooSubdomain, domain),
    repoName: row.repoName,
    repoOwner: row.repoOwner,
    repoUrl: row.repoUrl,
    updatedAt: toIsoString(row.updatedAt),
  };
}

function toAppDeploymentRun(
  row: AppDeploymentRunRow,
  deployment: AppDeploymentRow,
  domain: string,
): AppDeploymentRun {
  return {
    appId: row.appId,
    createdAt: toIsoString(row.createdAt),
    deploymentId: row.deploymentId,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    id: row.id,
    liveUrl: row.status === "success" ? row.url : null,
    plannedUrl: createPlannedUrl(deployment.mosooSubdomain, domain),
    sourceBranch: row.sourceBranch,
    sourceCommitSha: row.sourceCommitSha,
    status: row.status,
    targetKind: row.targetKind,
    updatedAt: toIsoString(row.updatedAt),
  };
}

function createMosooSubdomain(appId: AppId): string {
  return `app-${appId.toLowerCase()}`;
}

function createPlannedUrl(subdomain: string, domain: string): string {
  return `https://${subdomain}.${domain}`;
}

function normalizeConfigPath(value: string | null | undefined): ".mosoo.toml" | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value !== ".mosoo.toml") {
    throw validationError("configPath must be .mosoo.toml when provided.");
  }

  return value;
}

async function resolveGitHubRepository(
  repoUrl: string,
  fetcher: typeof fetch,
): Promise<{
  defaultBranch: string;
  repoName: string;
  repoOwner: string;
  repoUrl: string;
  sourceCommitSha: string;
}> {
  const parsed = parseGitHubRepoUrl(repoUrl);
  const repoJson = await fetchGitHubJson(
    fetcher,
    `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`,
    "GitHub repository",
  );

  if (readBoolean(repoJson, "private", "GitHub repository")) {
    throw validationError("GitHub repository must be public.");
  }

  const defaultBranch = readNonEmptyString(repoJson, "default_branch", "GitHub repository");
  const repoOwner = readGitHubOwner(repoJson["owner"]) ?? parsed.owner;
  const repoName = readOptionalString(repoJson, "name") ?? parsed.repo;
  const cloneUrl =
    readOptionalString(repoJson, "clone_url") ?? `https://github.com/${repoOwner}/${repoName}.git`;
  const branchJson = await fetchGitHubJson(
    fetcher,
    `https://api.github.com/repos/${repoOwner}/${repoName}/branches/${encodeURIComponent(defaultBranch)}`,
    "GitHub default branch",
  );
  const commit = requireRecord(branchJson["commit"], "GitHub default branch commit");

  return {
    defaultBranch,
    repoName,
    repoOwner,
    repoUrl: cloneUrl,
    sourceCommitSha: readNonEmptyString(commit, "sha", "GitHub default branch commit"),
  };
}

async function fetchGitHubJson(
  fetcher: typeof fetch,
  url: string,
  label: string,
): Promise<JsonRecord> {
  const response = await fetcher(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "mosoo-api",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (response.status === 404) {
    throw validationError(`${label} was not found.`);
  }

  if (!response.ok) {
    throw validationError(`${label} could not be checked.`);
  }

  return requireRecord(await response.json(), label);
}

function parseGitHubRepoUrl(repoUrl: string): { owner: string; repo: string } {
  let url: URL;

  try {
    url = new URL(repoUrl);
  } catch {
    throw validationError("repoUrl must be a GitHub HTTPS repository URL.");
  }

  if (url.protocol !== "https:" || url.hostname !== "github.com") {
    throw validationError("repoUrl must be a GitHub HTTPS repository URL.");
  }

  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);

  if (segments.length !== 2 || url.search !== "" || url.hash !== "") {
    throw validationError("repoUrl must point to a GitHub repository root.");
  }

  const owner = segments[0] ?? "";
  const repo = (segments[1] ?? "").replace(/\.git$/u, "");

  if (!/^[A-Za-z0-9.-]+$/u.test(owner) || !/^[A-Za-z0-9._-]+$/u.test(repo)) {
    throw validationError("repoUrl must point to a valid GitHub repository.");
  }

  return { owner, repo };
}

function requireRecord(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw validationError(`${label} response is invalid.`);
  }

  return value as JsonRecord;
}

function readNonEmptyString(record: JsonRecord, field: string, label: string): string {
  const value = record[field];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationError(`${label} response is invalid.`);
  }

  return value;
}

function readOptionalString(record: JsonRecord, field: string): string | null {
  const value = record[field];

  return typeof value === "string" && value.length > 0 ? value : null;
}

function readBoolean(record: JsonRecord, field: string, label: string): boolean {
  const value = record[field];

  if (typeof value !== "boolean") {
    throw validationError(`${label} response is invalid.`);
  }

  return value;
}

function readGitHubOwner(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const login = (value as JsonRecord)["login"];

  return typeof login === "string" && login.length > 0 ? login : null;
}
