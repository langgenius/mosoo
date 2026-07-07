import type { AppDeploymentRunRow, AppDeploymentRow } from "@mosoo/db";
import type { AppDeploymentRunId } from "@mosoo/id";

import { createErrorLogContext, logError } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import {
  destroyRuntimeSubjectContainer,
  getRuntimeSubjectKeepAliveHandle,
} from "../../runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-platform";
import type {
  ExecutionSessionHandle,
  SandboxHandle,
} from "../../runtime/infrastructure/sandbox-handles";
import { AppAgentBindingResolutionError } from "./app-agent-binding-resolution";
import type { CloudflareDeploymentClient } from "./app-deployment-cloudflare-client";
import { createCloudflareDeploymentClient } from "./app-deployment-cloudflare-client";
import {
  APP_DEPLOYMENT_COMPATIBILITY_DATE,
  detectAppDeploymentPlan,
} from "./app-deployment-detector";
import type { AppDeploymentPlan, AppDeploymentRepositorySnapshot } from "./app-deployment-detector";
import {
  completeDeploymentRun,
  failDeploymentRunIfActive,
  readCurrentDispatchContext,
  resolveDeploymentEnvVars,
  storeDeploymentPlan,
  updateRunStatus,
} from "./app-deployment-run-steps";
import type {
  AppDeploymentDeployResult,
  PreparedAppDeploymentRepository,
} from "./app-deployment-run-steps";
import { isNativeDeploymentRepo, runNativeDeploymentBranch } from "./native-deployment-executor";

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
const SNAPSHOT_AGENT_DIR_PREFIX = ".agent/";
// Mirrors the agent-package archive limits (pkgs/agent-package/src/
// archive-constants.ts): at most 512 `.agent/` entries enter the snapshot,
// and a single `.agent/` file contributes at most 2,000,000 UTF-16 code
// units of text (a conservative stand-in for the 2MB per-file byte limit).
const SNAPSHOT_AGENT_DIR_MAX_ENTRY_COUNT = 512;
const SNAPSHOT_AGENT_FILE_TEXT_LIMIT = 2_000_000;
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

/**
 * Path filter for repository snapshots. Legacy detection files are matched by
 * basename anywhere in the tree (unchanged); the native protocol widens the
 * snapshot to the whole `.agent/` subtree. `.git` internals never qualify —
 * the root `.git/` is already excluded from the sandbox file walk, and this
 * guard also covers nested `.git/` directories (vendored repositories).
 */
export function shouldIncludeSnapshotPath(path: string): boolean {
  if (path === ".git" || path.startsWith(".git/") || path.includes("/.git/")) {
    return false;
  }

  if (path.startsWith(SNAPSHOT_AGENT_DIR_PREFIX)) {
    return true;
  }

  const fileName = path.split("/").at(-1) ?? path;

  return SNAPSHOT_FILE_NAMES.has(fileName);
}

/**
 * Applies {@link shouldIncludeSnapshotPath} and caps the widened `.agent/`
 * surface at {@link SNAPSHOT_AGENT_DIR_MAX_ENTRY_COUNT} entries (callers pass
 * sorted paths, so the cap is deterministic). Exported for direct unit
 * coverage of the snapshot-widening rules.
 */
export function selectRepositorySnapshotPaths(paths: readonly string[]): string[] {
  const selected: string[] = [];
  let agentEntryCount = 0;

  for (const path of paths) {
    if (!shouldIncludeSnapshotPath(path)) {
      continue;
    }

    if (path.startsWith(SNAPSHOT_AGENT_DIR_PREFIX)) {
      if (agentEntryCount >= SNAPSHOT_AGENT_DIR_MAX_ENTRY_COUNT) {
        continue;
      }

      agentEntryCount += 1;
    }

    selected.push(path);
  }

  return selected;
}

/**
 * Content gate for widened `.agent/` snapshot files: oversized files and
 * content that did not survive UTF-8 decoding (binary skill support files,
 * PR #205, surface as U+FFFD replacement output) are skipped cleanly instead
 * of poisoning the snapshot.
 */
export function admitAgentSnapshotFileContent(content: string): boolean {
  return content.length <= SNAPSHOT_AGENT_FILE_TEXT_LIMIT && !content.includes("\uFFFD");
}

async function readRepositorySnapshot(
  sandbox: SandboxHandle,
  repoDir: string,
): Promise<AppDeploymentRepositorySnapshot> {
  const listResult = await sandbox.exec(
    `sh -lc ${quoteShellArg(
      `cd ${quoteShellArg(repoDir)} && find . -type f -not -path './.git/*' -print | sort`,
    )}`,
  );

  assertSuccessfulCommand(listResult, "Repository file listing");

  const files: Record<string, string> = {};
  const paths = selectRepositorySnapshotPaths(
    listResult.stdout
      .split("\n")
      .map((line) => line.trim().replace(/^\.\//u, ""))
      .filter((path) => path.length > 0),
  );

  await Promise.all(
    paths.map(async (path) => {
      if (path.startsWith(SNAPSHOT_AGENT_DIR_PREFIX)) {
        let content: string;

        try {
          content = (await sandbox.readFile(`${repoDir}/${path}`, { encoding: "utf8" })).content;
        } catch {
          // Unreadable `.agent/` entries (binary support files) are not
          // snapshot material; legacy detection files keep failing loudly.
          return;
        }

        if (admitAgentSnapshotFileContent(content)) {
          files[path] = content;
        }

        return;
      }

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

    let plan: AppDeploymentPlan;
    let envVars: Record<string, string>;

    if (isNativeDeploymentRepo(prepared.snapshot)) {
      // Protocol branch: validate → provision agents → capability env vars.
      // Agent-only repos (and every native failure) reach a terminal state
      // inside the branch; [expose.web] repos come back with a worker plan
      // and continue through the ordinary build→deploy→complete chain below.
      const native = await runNativeDeploymentBranch(bindings, {
        context,
        prepared,
        targetName,
      });

      if (native.kind === "handled") {
        return;
      }

      ({ envVars, plan } = native);
    } else {
      plan = detectAppDeploymentPlan(prepared.snapshot, { resourceName: targetName });

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
