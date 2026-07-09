import type { AppDeploymentRunStatus } from "@mosoo/contracts/app";
import type { AppDeploymentRunRow, AppDeploymentRow } from "@mosoo/db";
import { appDeploymentRunsTable, appDeploymentsTable } from "@mosoo/db";
import type { AppDeploymentRunId } from "@mosoo/id";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { createErrorLogContext, logError } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase, getD1ChangeCount } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { listAppOwnerAgentRows } from "../../agents/application/agent-repository";
import { boundAgentUrl, mintAppAgentCapabilityToken } from "../../public-api/app-agent-capability";
import {
  destroyRuntimeSubjectContainer,
  getRuntimeSubjectKeepAliveHandle,
} from "../../runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-platform";
import type {
  ExecutionSessionHandle,
  SandboxHandle,
} from "../../runtime/infrastructure/sandbox-handles";
import { ACTIVE_APP_DEPLOYMENT_RUN_STATUSES } from "../domain/app-deployment-lifecycle";
import {
  AppAgentBindingResolutionError,
  resolveAppAgentBindings,
} from "./app-agent-binding-resolution";
import type { ResolvableAppAgent } from "./app-agent-binding-resolution";
import type { CloudflareDeploymentClient } from "./app-deployment-cloudflare-client";
import { createCloudflareDeploymentClient } from "./app-deployment-cloudflare-client";
import {
  APP_DEPLOYMENT_COMPATIBILITY_DATE,
  detectAppDeploymentPlan,
} from "./app-deployment-detector";
import type { AppDeploymentPlan, AppDeploymentRepositorySnapshot } from "./app-deployment-detector";

interface AppDeploymentDispatchContext {
  deployment: AppDeploymentRow;
  run: AppDeploymentRunRow;
}

interface PreparedAppDeploymentRepository {
  repoDir: string;
  snapshot: AppDeploymentRepositorySnapshot;
}

interface AppDeploymentDeployResult {
  externalDeploymentId: string | null;
  externalProjectId: string | null;
  externalVersionId: string | null;
  url: string;
}

export interface AppDeploymentBuildRunner {
  build(input: {
    plan: AppDeploymentPlan;
    prepared: PreparedAppDeploymentRepository;
  }): Promise<void>;
  cleanup?(): Promise<void>;
  deploy(input: {
    deployment: AppDeploymentRow;
    envVars: Record<string, string>;
    plan: AppDeploymentPlan;
    prepared: PreparedAppDeploymentRepository;
    run: AppDeploymentRunRow;
  }): Promise<AppDeploymentDeployResult>;
  prepare(input: {
    deployment: AppDeploymentRow;
    run: AppDeploymentRunRow;
  }): Promise<PreparedAppDeploymentRepository>;
}

export interface DispatchAppDeploymentRunOptions {
  cloudflareClient?: CloudflareDeploymentClient;
  runner?: AppDeploymentBuildRunner;
}

export class AppDeploymentNonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppDeploymentNonRetryableError";
  }
}

const SNAPSHOT_FILE_NAMES = new Set([
  ".mosoo.toml",
  "bun.lock",
  "bun.lockb",
  "index.html",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "wrangler.json",
  "wrangler.jsonc",
  "wrangler.toml",
  "yarn.lock",
]);
const WORKER_JS_ENTRY_PATTERN = /\.(?:mjs|js)$/u;
export function appDeploymentBuildSandboxId(runId: AppDeploymentRunId): string {
  return `${runId}-build`;
}

export function appDeploymentDeploySandboxId(runId: AppDeploymentRunId): string {
  return `${runId}-deploy`;
}

function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function deploymentHostname(deployment: AppDeploymentRow, domain: string): string {
  return `${deployment.mosooSubdomain}.${domain}`;
}

function deploymentUrl(deployment: AppDeploymentRow, domain: string): string {
  return `https://${deploymentHostname(deployment, domain)}`;
}

function isActiveRunStatus(status: AppDeploymentRunStatus): boolean {
  return (ACTIVE_APP_DEPLOYMENT_RUN_STATUSES as readonly AppDeploymentRunStatus[]).includes(status);
}

function commandFailureMessage(
  result: { exitCode: number; stderr: string; stdout: string; success: boolean },
  label: string,
): string | null {
  if (result.success && result.exitCode === 0) {
    return null;
  }

  return result.stderr.trim() || result.stdout.trim() || `${label} failed.`;
}

function assertSuccessfulCommand(
  result: { exitCode: number; stderr: string; stdout: string; success: boolean },
  label: string,
): void {
  const message = commandFailureMessage(result, label);

  if (message !== null) {
    throw new Error(message);
  }
}

async function execChecked(
  session: ExecutionSessionHandle,
  command: string,
  label: string,
  options: { retryable?: boolean } = {},
): Promise<void> {
  const message = commandFailureMessage(
    await session.exec(`sh -lc ${quoteShellArg(command)}`),
    label,
  );

  if (message === null) {
    return;
  }

  if (options.retryable === false) {
    throw new AppDeploymentNonRetryableError(message);
  }

  throw new Error(message);
}

function assertSelfContainedWorkerModule(scriptContent: string): void {
  if (/^\s*import\s/mu.test(scriptContent) || /\bimport\s*\(/u.test(scriptContent)) {
    throw new AppDeploymentNonRetryableError(
      "Worker deployment only supports self-contained JavaScript modules in the first cut.",
    );
  }
}

function assertRequestedMosooConfigPresent(
  run: AppDeploymentRunRow,
  snapshot: AppDeploymentRepositorySnapshot,
): void {
  if (run.mosooConfigJson === null) {
    return;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(run.mosooConfigJson);
  } catch {
    throw new AppDeploymentNonRetryableError("App deployment config metadata is invalid.");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Reflect.get(parsed, "configPath") !== ".mosoo.toml"
  ) {
    throw new AppDeploymentNonRetryableError("App deployment config metadata is invalid.");
  }

  if (snapshot.files[".mosoo.toml"] === undefined) {
    throw new AppDeploymentNonRetryableError("Requested .mosoo.toml was not found.");
  }
}

async function assertControlledWranglerAvailable(sandbox: SandboxHandle): Promise<void> {
  await execChecked(
    sandbox,
    "command -v wrangler >/dev/null && wrangler --version >/dev/null",
    "Controlled Wrangler availability",
    { retryable: false },
  );
}

export async function destroyAppDeploymentRunSandboxesBestEffort(
  bindings: ApiBindings,
  runId: AppDeploymentRunId,
): Promise<void> {
  await Promise.all([
    destroyDeploymentSandboxBestEffort(
      bindings,
      appDeploymentBuildSandboxId(runId),
      "app-deployment.build_sandbox_destroy_failed",
    ),
    destroyDeploymentSandboxBestEffort(
      bindings,
      appDeploymentDeploySandboxId(runId),
      "app-deployment.deploy_sandbox_destroy_failed",
    ),
  ]);
}

async function destroyDeploymentSandboxBestEffort(
  bindings: ApiBindings,
  sandboxId: string,
  eventName: string,
): Promise<void> {
  try {
    await destroyRuntimeSubjectContainer(bindings, sandboxId);
  } catch (error) {
    logError(eventName, {
      ...createErrorLogContext(error),
      sandboxId,
    });
  }
}

async function readCurrentDispatchContext(
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

async function updateRunStatus(
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

async function storeDeploymentPlan(input: {
  database: D1Database;
  plan: AppDeploymentPlan;
  runId: AppDeploymentRunId;
  targetName: string;
}): Promise<boolean> {
  const targetKind = input.plan.targetKind;
  const result = await getAppDatabase(input.database)
    .update(appDeploymentRunsTable)
    .set({
      generatedWranglerConfigJson: JSON.stringify({ toml: input.plan.generatedWranglerConfig }),
      planJson: JSON.stringify(input.plan),
      targetKind,
      targetProjectName: targetKind === "cloudflare_pages" ? input.targetName : null,
      targetScriptName: targetKind === "cloudflare_worker" ? input.targetName : null,
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

async function failDeploymentRunIfActive(input: {
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

async function completeDeploymentRun(input: {
  database: D1Database;
  deployment: AppDeploymentRow;
  result: AppDeploymentDeployResult;
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

function shouldIncludeSnapshotPath(path: string): boolean {
  const fileName = path.split("/").at(-1) ?? path;

  return SNAPSHOT_FILE_NAMES.has(fileName);
}

async function readRepositorySnapshot(
  sandbox: SandboxHandle,
  repoDir: string,
): Promise<AppDeploymentRepositorySnapshot> {
  const listResult = await sandbox.exec(
    `sh -lc ${quoteShellArg(`cd ${quoteShellArg(repoDir)} && find . -type f -print | sort`)}`,
  );

  assertSuccessfulCommand(listResult, "Repository file listing");

  const files: Record<string, string> = {};
  const paths = listResult.stdout
    .split("\n")
    .map((line) => line.trim().replace(/^\.\//u, ""))
    .filter((path) => path.length > 0 && shouldIncludeSnapshotPath(path));

  await Promise.all(
    paths.map(async (path) => {
      files[path] = (await sandbox.readFile(`${repoDir}/${path}`, { encoding: "utf8" })).content;
    }),
  );

  return { files };
}

function pagesRoutesFallbackCommands(plan: AppDeploymentPlan, outputDir: string): string[] {
  if (plan.routesFallback === null) {
    return [];
  }

  return [
    `printf '%s\\n' ${quoteShellArg(`/* /${plan.routesFallback} 200`)} > ${quoteShellArg(
      `${outputDir}/_redirects`,
    )}`,
  ];
}

async function createPagesArtifactArchive(input: {
  plan: AppDeploymentPlan;
  prepared: PreparedAppDeploymentRepository;
  buildSandbox: SandboxHandle;
  workDir: string;
}): Promise<string> {
  if (input.plan.outputDir === null) {
    throw new AppDeploymentNonRetryableError("Pages deployment plan is missing outputDir.");
  }

  const archivePath = `${input.workDir}/artifact.tar`;
  const outputDir = `${input.prepared.repoDir}/${input.plan.rootDir}/${input.plan.outputDir}`;
  await execChecked(
    input.buildSandbox,
    [
      `rm -f ${quoteShellArg(archivePath)}`,
      ...pagesRoutesFallbackCommands(input.plan, outputDir),
      `cd ${quoteShellArg(outputDir)}`,
      `find . -type f -print0 | tar --null --no-recursion -cf ${quoteShellArg(archivePath)} -T -`,
    ].join(" && "),
    "Pages artifact archive",
    { retryable: false },
  );

  return (await input.buildSandbox.readFile(archivePath, { encoding: "base64" })).content;
}

async function extractPagesArtifactArchive(input: {
  archiveBase64: string;
  deploySandbox: SandboxHandle;
  workDir: string;
}): Promise<{ artifactDir: string; deployDir: string }> {
  const artifactDir = `${input.workDir}/artifact`;
  const archiveBase64Path = `${input.workDir}/artifact.tar.b64`;
  const archivePath = `${input.workDir}/artifact.tar`;
  const deployDir = `${input.workDir}/deploy`;

  await execChecked(
    input.deploySandbox,
    [
      `rm -rf ${quoteShellArg(input.workDir)}`,
      `mkdir -p ${quoteShellArg(artifactDir)} ${quoteShellArg(deployDir)}`,
    ].join(" && "),
    "Pages deploy workspace",
  );
  await input.deploySandbox.writeFile(archiveBase64Path, input.archiveBase64);
  await execChecked(
    input.deploySandbox,
    [
      `base64 -d ${quoteShellArg(archiveBase64Path)} > ${quoteShellArg(archivePath)}`,
      `tar -xf ${quoteShellArg(archivePath)} -C ${quoteShellArg(artifactDir)}`,
    ].join(" && "),
    "Pages artifact extraction",
  );

  return { artifactDir, deployDir };
}

class SandboxAppDeploymentBuildRunner implements AppDeploymentBuildRunner {
  readonly #bindings: ApiBindings;
  readonly #cloudflareClient: CloudflareDeploymentClient;
  #buildSandbox: SandboxHandle | null = null;
  #buildWorkDir: string | null = null;
  #runId: AppDeploymentRunId | null = null;

  constructor(bindings: ApiBindings, cloudflareClient: CloudflareDeploymentClient) {
    this.#bindings = bindings;
    this.#cloudflareClient = cloudflareClient;
  }

  async prepare(input: {
    deployment: AppDeploymentRow;
    run: AppDeploymentRunRow;
  }): Promise<PreparedAppDeploymentRepository> {
    const sandbox = await getRuntimeSubjectKeepAliveHandle(
      this.#bindings,
      appDeploymentBuildSandboxId(input.run.id),
    );
    const workDir = `/tmp/mosoo-app-deployment-build-${input.run.id}`;
    const repoDir = `${workDir}/repo`;
    const cloneCommand = [
      `rm -rf ${quoteShellArg(workDir)}`,
      `mkdir -p ${quoteShellArg(workDir)}`,
      `git clone --no-tags --depth 1 ${quoteShellArg(input.deployment.repoUrl)} ${quoteShellArg(repoDir)}`,
      `cd ${quoteShellArg(repoDir)}`,
      `git fetch --no-tags --depth 1 origin ${quoteShellArg(input.run.sourceCommitSha)}`,
      `git checkout --detach ${quoteShellArg(input.run.sourceCommitSha)}`,
    ].join(" && ");

    await sandbox.setKeepAlive(true);
    await execChecked(sandbox, cloneCommand, "Repository clone");

    this.#buildSandbox = sandbox;
    this.#buildWorkDir = workDir;
    this.#runId = input.run.id;

    return {
      repoDir,
      snapshot: await readRepositorySnapshot(sandbox, repoDir),
    };
  }

  async build(input: {
    plan: AppDeploymentPlan;
    prepared: PreparedAppDeploymentRepository;
  }): Promise<void> {
    const sandbox = this.#requireBuildSandbox();
    const commands = [input.plan.installCommand, input.plan.buildCommand].filter(
      (command): command is string => command !== null,
    );

    if (commands.length === 0) {
      return;
    }

    const buildSession = await sandbox.createSession({
      cwd: `${input.prepared.repoDir}/${input.plan.rootDir}`,
    });

    await execChecked(
      buildSession,
      ["unset CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_ZONE_ID", ...commands].join(
        " && ",
      ),
      "App deployment build",
      { retryable: false },
    );
  }

  async deploy(input: {
    deployment: AppDeploymentRow;
    envVars: Record<string, string>;
    plan: AppDeploymentPlan;
    prepared: PreparedAppDeploymentRepository;
    run: AppDeploymentRunRow;
  }): Promise<AppDeploymentDeployResult> {
    const buildSandbox = this.#requireBuildSandbox();
    const buildWorkDir = this.#requireBuildWorkDir();
    const targetName = input.deployment.mosooSubdomain;
    const domain = this.#bindings.MOSOO_APP_DEPLOYMENT_DOMAIN;
    const hostname = deploymentHostname(input.deployment, domain);

    if (input.plan.targetKind === "cloudflare_pages") {
      const project = await this.#cloudflareClient.ensurePagesProject({
        branch: input.run.sourceBranch,
        projectName: targetName,
      });
      const archiveBase64 = await createPagesArtifactArchive({
        buildSandbox,
        plan: input.plan,
        prepared: input.prepared,
        workDir: buildWorkDir,
      });
      await this.#destroyBuildSandbox();

      const deploySandbox = await getRuntimeSubjectKeepAliveHandle(
        this.#bindings,
        appDeploymentDeploySandboxId(input.run.id),
      );
      const deployWorkDir = `/tmp/mosoo-app-deployment-deploy-${input.run.id}`;
      await deploySandbox.setKeepAlive(true);
      await assertControlledWranglerAvailable(deploySandbox);
      const { artifactDir, deployDir } = await extractPagesArtifactArchive({
        archiveBase64,
        deploySandbox,
        workDir: deployWorkDir,
      });
      const deploySession = await deploySandbox.createSession({
        cwd: deployDir,
        env: {
          CLOUDFLARE_ACCOUNT_ID: this.#bindings.CLOUDFLARE_ACCOUNT_ID,
          CLOUDFLARE_API_TOKEN: this.#bindings.CLOUDFLARE_API_TOKEN,
        },
      });

      await execChecked(
        deploySession,
        [
          "wrangler",
          "pages",
          "deploy",
          quoteShellArg(artifactDir),
          "--project-name",
          quoteShellArg(targetName),
          "--branch",
          quoteShellArg(input.run.sourceBranch),
        ].join(" "),
        "Cloudflare Pages deploy",
      );

      const [latestDeployment, domainResult] = await Promise.all([
        this.#cloudflareClient.getLatestPagesDeployment({
          projectName: targetName,
        }),
        this.#cloudflareClient.ensurePagesDomain({
          hostname,
          projectName: targetName,
        }),
      ]);
      const url =
        domainResult.status === "active"
          ? deploymentUrl(input.deployment, domain)
          : latestDeployment.url;

      if (url === null) {
        throw new Error("Cloudflare Pages deployment response did not include a live URL.");
      }

      return {
        externalDeploymentId: latestDeployment.deploymentId,
        externalProjectId: project.projectId,
        externalVersionId: null,
        url,
      };
    }

    if (input.plan.workerEntry === null) {
      throw new AppDeploymentNonRetryableError("Worker deployment plan is missing workerEntry.");
    }

    if (!WORKER_JS_ENTRY_PATTERN.test(input.plan.workerEntry)) {
      throw new AppDeploymentNonRetryableError(
        "Worker deployment requires a JavaScript module entry.",
      );
    }

    const mainModuleName = input.plan.workerEntry.split("/").at(-1) ?? input.plan.workerEntry;
    const scriptContent = (
      await buildSandbox.readFile(
        `${input.prepared.repoDir}/${input.plan.rootDir}/${input.plan.workerEntry}`,
        {
          encoding: "utf8",
        },
      )
    ).content;
    assertSelfContainedWorkerModule(scriptContent);
    await this.#destroyBuildSandbox();

    const worker = await this.#cloudflareClient.deployWorkerModule({
      compatibilityDate: APP_DEPLOYMENT_COMPATIBILITY_DATE,
      mainModuleName,
      scriptContent,
      scriptName: targetName,
      vars: input.envVars,
    });
    await this.#cloudflareClient.ensureWorkerRoute({
      hostname,
      scriptName: targetName,
    });
    await this.#cloudflareClient.ensureWorkerDomain({
      hostname,
      scriptName: targetName,
    });

    return {
      externalDeploymentId: worker.deploymentId,
      externalProjectId: null,
      externalVersionId: worker.versionId,
      url: deploymentUrl(input.deployment, domain),
    };
  }

  async cleanup(): Promise<void> {
    if (this.#runId === null) {
      return;
    }

    await destroyAppDeploymentRunSandboxesBestEffort(this.#bindings, this.#runId);
    this.#buildSandbox = null;
    this.#buildWorkDir = null;
  }

  async #destroyBuildSandbox(): Promise<void> {
    if (this.#runId === null || this.#buildSandbox === null) {
      return;
    }

    await destroyDeploymentSandboxBestEffort(
      this.#bindings,
      appDeploymentBuildSandboxId(this.#runId),
      "app-deployment.build_sandbox_destroy_failed",
    );
    this.#buildSandbox = null;
    this.#buildWorkDir = null;
  }

  #requireBuildSandbox(): SandboxHandle {
    if (this.#buildSandbox === null) {
      throw new Error("App deployment sandbox was not prepared.");
    }

    return this.#buildSandbox;
  }

  #requireBuildWorkDir(): string {
    if (this.#buildWorkDir === null) {
      throw new Error("App deployment work directory was not prepared.");
    }

    return this.#buildWorkDir;
  }
}

// Long-lived: the injected URL lives with the deployed Worker and is revoked by
// deleting the deployment (which destroys the Worker) plus the ask endpoint's
// re-check that the agent is still published. See docs/prd/app-deployment.md.
const APP_AGENT_CAPABILITY_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000;

// Resolve `.mosoo.toml [[agents]]` bindings to published agents and mint one
// self-authorizing capability URL per binding (fail-fast on an unpublished or
// missing agent). Returns the env var map injected into the deployed Worker.
async function resolveDeploymentEnvVars(
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

export async function dispatchAppDeploymentRun(
  bindings: ApiBindings,
  input: { appDeploymentRunId: AppDeploymentRunId },
  options: DispatchAppDeploymentRunOptions = {},
): Promise<void> {
  let context = await readCurrentDispatchContext(bindings.DB, input.appDeploymentRunId);

  if (context === null) {
    return;
  }

  if (!(await updateRunStatus(bindings.DB, input.appDeploymentRunId, "preparing"))) {
    return;
  }

  const cloudflareClient =
    options.cloudflareClient ??
    (options.runner === undefined ? createCloudflareDeploymentClient(bindings) : null);
  const runner =
    options.runner ??
    new SandboxAppDeploymentBuildRunner(
      bindings,
      cloudflareClient ?? createCloudflareDeploymentClient(bindings),
    );

  try {
    const prepared = await runner.prepare(context);
    const targetName = context.deployment.mosooSubdomain;
    assertRequestedMosooConfigPresent(context.run, prepared.snapshot);
    const plan = detectAppDeploymentPlan(prepared.snapshot, { resourceName: targetName });

    if (
      !(await storeDeploymentPlan({
        database: bindings.DB,
        plan,
        runId: context.run.id,
        targetName,
      }))
    ) {
      return;
    }

    let envVars: Record<string, string>;
    try {
      envVars = await resolveDeploymentEnvVars(bindings, context.deployment, plan);
    } catch (error) {
      if (error instanceof AppAgentBindingResolutionError) {
        await failDeploymentRunIfActive({
          database: bindings.DB,
          errorCode: error.code,
          errorMessage: error.message,
          runId: context.run.id,
        });
        return;
      }
      throw error;
    }

    if (!(await updateRunStatus(bindings.DB, input.appDeploymentRunId, "building"))) {
      return;
    }

    await runner.build({ plan, prepared });

    if (!(await updateRunStatus(bindings.DB, input.appDeploymentRunId, "submitting"))) {
      await failDeploymentRunIfActive({
        database: bindings.DB,
        errorCode: "deployment_submission_lost",
        errorMessage: "Deployment built but the deployment run changed.",
        runId: context.run.id,
      });
      return;
    }

    context = await readCurrentDispatchContext(bindings.DB, input.appDeploymentRunId);

    if (context === null) {
      await failDeploymentRunIfActive({
        database: bindings.DB,
        errorCode: "deployment_context_lost",
        errorMessage: "Deployment context was lost after build.",
        runId: input.appDeploymentRunId,
      });
      return;
    }

    const result = await runner.deploy({ ...context, envVars, plan, prepared });

    if (!(await updateRunStatus(bindings.DB, input.appDeploymentRunId, "submitted"))) {
      await failDeploymentRunIfActive({
        database: bindings.DB,
        errorCode: "deployment_submission_lost",
        errorMessage: "Deployment submitted externally but the deployment run changed.",
        runId: context.run.id,
      });
      return;
    }

    if (!(await updateRunStatus(bindings.DB, input.appDeploymentRunId, "activating"))) {
      await failDeploymentRunIfActive({
        database: bindings.DB,
        errorCode: "deployment_activation_lost",
        errorMessage: "Deployment activated externally but the deployment run changed.",
        runId: context.run.id,
      });
      return;
    }

    const completed = await completeDeploymentRun({
      database: bindings.DB,
      deployment: context.deployment,
      result,
      run: context.run,
    });

    if (!completed) {
      await failDeploymentRunIfActive({
        database: bindings.DB,
        errorCode: "deployment_completion_lost",
        errorMessage: "Deployment completed externally but the App deployment row changed.",
        runId: context.run.id,
      });
    }
  } finally {
    await runner.cleanup?.();
  }
}
