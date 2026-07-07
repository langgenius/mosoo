import { describe, expect, test } from "bun:test";

import { MOSOO_NATIVE_SPEC } from "@mosoo/contracts/native-deployment";
import { parseNativeDeploymentRunResult } from "@mosoo/contracts/native-deployment-run";
import { createAgentManifestJson } from "@mosoo/contracts/native-repo-fixtures";
import type { AppDeploymentRunRow } from "@mosoo/db";
import { appDeploymentRunsTable } from "@mosoo/db";
import type { AppId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import type { AppDeploymentBuildRunner } from "../src/modules/apps/application/app-deployment-executor.service";
import {
  admitAgentSnapshotFileContent,
  dispatchAppDeploymentRun,
  selectRepositorySnapshotPaths,
  shouldIncludeSnapshotPath,
} from "../src/modules/apps/application/app-deployment-executor.service";
import {
  deployApp,
  getAppDeploymentStatus,
  listAppDeploymentRuns,
} from "../src/modules/apps/application/app-deployment.service";
import { validateNativeDeployment } from "../src/modules/apps/application/native-deployment-validator";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { currentTimestampMs } from "../src/time";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  PUBLIC_API_TEST_IDS,
  PublicApiMemoryFileBucket,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/sqlite-d1";
import { OWNER_VIEWER, withProviderProbeMock } from "./public-thread-api-fixtures";

const APP_ID = PUBLIC_API_TEST_IDS.app as AppId;
const NATIVE_MARKER_TOML = `spec = "${MOSOO_NATIVE_SPEC}"\n`;
const DEPLOY_URL = "https://deployed.example";

function openaiAgentManifest(name: string, overrides: Record<string, unknown> = {}): string {
  return createAgentManifestJson(name, {
    model: "gpt-5.4",
    provider: "openai",
    runtime: "openai-runtime",
    ...overrides,
  });
}

async function createFixture() {
  const database = await createPublicHttpContractDatabase();

  database.execute(`
    CREATE TABLE app_deployment (
      app_id text NOT NULL,
      created_at integer NOT NULL,
      default_branch text NOT NULL,
      deleted_at integer,
      id text PRIMARY KEY NOT NULL,
      last_successful_url text,
      latest_run_id text,
      mosoo_subdomain text NOT NULL,
      owner_account_id text NOT NULL,
      repo_name text NOT NULL,
      repo_owner text NOT NULL,
      repo_url text NOT NULL,
      source_kind text NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE UNIQUE INDEX app_deployment_active_app_idx
      ON app_deployment (app_id)
      WHERE deleted_at IS NULL;

    CREATE TABLE app_deployment_run (
      app_id text NOT NULL,
      created_at integer NOT NULL,
      deployment_id text NOT NULL,
      error_code text,
      error_message text,
      external_deployment_id text,
      external_project_id text,
      external_version_id text,
      generated_wrangler_config_json text,
      id text PRIMARY KEY NOT NULL,
      mosoo_config_json text,
      native_result_json text,
      plan_json text,
      source_branch text NOT NULL,
      source_commit_sha text NOT NULL,
      status text NOT NULL,
      target_kind text,
      target_project_name text,
      target_script_name text,
      updated_at integer NOT NULL,
      url text
    );

    CREATE UNIQUE INDEX app_deployment_run_active_app_idx
      ON app_deployment_run (app_id)
      WHERE status IN ('queued', 'preparing', 'building', 'submitting', 'submitted', 'activating');

    CREATE TABLE IF NOT EXISTS skill_snapshot (
      id text PRIMARY KEY NOT NULL,
      author text NOT NULL,
      blob_key text NOT NULL,
      blob_sha256 text NOT NULL,
      blob_size integer NOT NULL,
      created_at integer NOT NULL,
      description text NOT NULL,
      name text NOT NULL,
      app_id text NOT NULL,
      skill_markdown_path text NOT NULL,
      uncompressed_size integer NOT NULL,
      version text
    );

    CREATE UNIQUE INDEX IF NOT EXISTS skill_snapshot_blob_sha256_idx
      ON skill_snapshot (app_id, blob_sha256);

    CREATE TABLE IF NOT EXISTS skill_snapshot_entry (
      entry_kind text NOT NULL,
      is_executable integer NOT NULL,
      mime_type text,
      path text NOT NULL,
      sha256 text,
      size integer NOT NULL,
      snapshot_id text NOT NULL,
      PRIMARY KEY (snapshot_id, path)
    );
  `);

  const bindings = createPublicHttpTestBindings(database, {
    fileBucket: new PublicApiMemoryFileBucket() as unknown as R2Bucket,
  }) as ApiBindings;

  return { bindings, database };
}

const githubFetch: typeof fetch = async (input) => {
  const url = input instanceof URL ? input.href : typeof input === "string" ? input : input.url;

  if (url === "https://api.github.com/repos/samzong/awire") {
    return Response.json({
      clone_url: "https://github.com/samzong/awire.git",
      default_branch: "main",
      name: "awire",
      owner: { login: "samzong" },
      private: false,
    });
  }

  if (url === "https://api.github.com/repos/samzong/awire/branches/main") {
    return Response.json({
      commit: { sha: "abc123" },
    });
  }

  return new Response("not found", { status: 404 });
};

interface FakeRunnerState {
  buildCount: number;
  deployCount: number;
  deployedEnvVars: Record<string, string> | null;
}

function createFakeRunner(files: Readonly<Record<string, string>>) {
  const state: FakeRunnerState = {
    buildCount: 0,
    deployCount: 0,
    deployedEnvVars: null,
  };
  const runner: AppDeploymentBuildRunner = {
    async build() {
      state.buildCount += 1;
    },
    async deploy({ envVars }) {
      state.deployCount += 1;
      state.deployedEnvVars = envVars;
      return {
        externalDeploymentId: "external-deploy-1",
        externalProjectId: null,
        externalVersionId: "external-version-1",
        url: DEPLOY_URL,
      };
    },
    async prepare() {
      return { repoDir: "/repo", snapshot: { files } };
    },
  };

  return { runner, state };
}

async function dispatchRepo(
  bindings: ApiBindings,
  database: SqliteD1Database,
  files: Readonly<Record<string, string>>,
): Promise<{ runRow: AppDeploymentRunRow; state: FakeRunnerState }> {
  const run = await deployApp(
    bindings,
    OWNER_VIEWER,
    { appId: APP_ID, repoUrl: "https://github.com/samzong/awire" },
    { fetch: githubFetch, nowMs: currentTimestampMs },
  );
  const { runner, state } = createFakeRunner(files);

  await withProviderProbeMock(() =>
    dispatchAppDeploymentRun(bindings, { appDeploymentRunId: run.id }, { runner }),
  );

  const runRow = await database
    .app()
    .select()
    .from(appDeploymentRunsTable)
    .where(eq(appDeploymentRunsTable.id, run.id))
    .limit(1)
    .get();

  if (runRow === undefined) {
    throw new Error("Deployment run row missing after dispatch.");
  }

  return { runRow, state };
}

async function countAppAgents(database: SqliteD1Database): Promise<number> {
  const row = await database
    .prepare("SELECT COUNT(*) AS count FROM agent WHERE app_id = ?")
    .bind(APP_ID)
    .first<{ count: number }>();

  return row?.count ?? 0;
}

async function readAgentRowByName(database: SqliteD1Database, name: string) {
  return database
    .prepare(
      `
        SELECT id, live_deployment_version_id, status
          FROM agent
         WHERE app_id = ? AND name = ?
      `,
    )
    .bind(APP_ID, name)
    .first<{ id: string; live_deployment_version_id: string | null; status: string }>();
}

function parsePlanJson(runRow: AppDeploymentRunRow): Record<string, unknown> {
  if (runRow.planJson === null) {
    throw new Error("Expected plan_json on the run row.");
  }

  return JSON.parse(runRow.planJson) as Record<string, unknown>;
}

describe("native deployment executor", () => {
  test("keeps a plain repo without the marker on the legacy path", async () => {
    const { bindings, database } = await createFixture();

    const { runRow, state } = await dispatchRepo(bindings, database, {
      "index.html": "<main>Hello</main>",
    });

    expect(runRow).toMatchObject({
      errorCode: null,
      nativeResultJson: null,
      status: "success",
      targetKind: "cloudflare_pages",
      url: DEPLOY_URL,
    });
    expect(state.buildCount).toBe(1);
    expect(state.deployCount).toBe(1);
    expect(await countAppAgents(database)).toBe(1);
  });

  test("keeps a legacy .mosoo.toml without a spec key on the legacy path", async () => {
    const { bindings, database } = await createFixture();

    const { runRow, state } = await dispatchRepo(bindings, database, {
      ".mosoo.toml": 'schema = 1\ntype = "worker"\n\n[worker]\nentry = "index.js"\n',
      "index.js": "export default {};\n",
    });

    expect(runRow).toMatchObject({
      errorCode: null,
      nativeResultJson: null,
      status: "success",
      targetKind: "cloudflare_worker",
      url: DEPLOY_URL,
    });
    expect(state.deployCount).toBe(1);
    expect(await countAppAgents(database)).toBe(1);
  });

  test("fails a red repo with native_validation_failed and the exact validate report", async () => {
    const { bindings, database } = await createFixture();
    const files = {
      ".agent/manifest.json": createAgentManifestJson("quiz-master", { prompts: undefined }),
      ".mosoo.toml": NATIVE_MARKER_TOML,
    };

    const { runRow, state } = await dispatchRepo(bindings, database, files);

    expect(runRow.status).toBe("failed");
    expect(runRow.errorCode).toBe("native_validation_failed");
    expect(runRow.errorMessage).toContain(".agent/manifest.json");

    const native = parseNativeDeploymentRunResult(runRow.nativeResultJson);

    expect(native).not.toBeNull();
    expect(native?.facts).toBeNull();
    expect(native?.validate).toEqual(validateNativeDeployment({ files }));
    expect(state.buildCount).toBe(0);
    expect(state.deployCount).toBe(0);
    expect(await countAppAgents(database)).toBe(1);
  });

  test("routes an unparseable marker that declares spec to the native validator", async () => {
    const { bindings, database } = await createFixture();

    const { runRow } = await dispatchRepo(bindings, database, {
      ".agent/manifest.json": createAgentManifestJson("quiz-master"),
      ".mosoo.toml": `spec = "${MOSOO_NATIVE_SPEC}`,
    });

    expect(runRow.status).toBe("failed");
    expect(runRow.errorCode).toBe("native_validation_failed");

    const native = parseNativeDeploymentRunResult(runRow.nativeResultJson);

    expect(native?.validate.failures.map((failure) => failure.code)).toEqual([
      "native.toml.parse_error",
    ]);
    expect(await countAppAgents(database)).toBe(1);
  });

  test("completes an agent-only repo with no build, no deploy, and no URL", async () => {
    const { bindings, database } = await createFixture();
    const files = {
      ".agent/manifest.json": openaiAgentManifest("quiz-master"),
      ".mosoo.toml": NATIVE_MARKER_TOML,
    };

    const { runRow, state } = await dispatchRepo(bindings, database, files);

    expect(runRow).toMatchObject({
      errorCode: null,
      status: "success",
      targetKind: null,
      targetProjectName: null,
      targetScriptName: null,
      url: null,
    });
    expect(state.buildCount).toBe(0);
    expect(state.deployCount).toBe(0);

    const plan = parsePlanJson(runRow);

    expect(plan["targetKind"]).toBe("agent_only");
    expect(plan["agentBindings"]).toEqual([]);

    const agent = await readAgentRowByName(database, "quiz-master");

    expect(agent?.status).toBe("published");
    expect(agent?.live_deployment_version_id).toBeTruthy();

    const native = parseNativeDeploymentRunResult(runRow.nativeResultJson);

    expect(native?.facts).toEqual({
      agentCount: 1,
      agents: [{ action: "created", exposed: true, name: "quiz-master", versionNumber: 1 }],
      specVersion: MOSOO_NATIVE_SPEC,
      web: { declared: false },
    });

    await expect(getAppDeploymentStatus(bindings, OWNER_VIEWER, APP_ID)).resolves.toMatchObject({
      liveUrl: null,
      status: "success",
    });

    const runs = await listAppDeploymentRuns(bindings, OWNER_VIEWER, APP_ID, 10);

    expect(runs[0]?.native?.facts?.agents).toEqual([
      { action: "created", exposed: true, name: "quiz-master", versionNumber: 1 },
    ]);
  });

  test("re-dispatching an identical agent-only repo reports unchanged", async () => {
    const { bindings, database } = await createFixture();
    const files = {
      ".agent/manifest.json": openaiAgentManifest("quiz-master"),
      ".mosoo.toml": NATIVE_MARKER_TOML,
    };

    const first = await dispatchRepo(bindings, database, files);

    expect(first.runRow.status).toBe("success");

    const second = await dispatchRepo(bindings, database, files);

    expect(second.runRow.status).toBe("success");

    const native = parseNativeDeploymentRunResult(second.runRow.nativeResultJson);

    expect(native?.facts?.agents).toEqual([
      { action: "unchanged", exposed: true, name: "quiz-master" },
    ]);
    expect(await countAppAgents(database)).toBe(2);
  });

  test("deploys an [expose.web] worker repo with the agent capability env var", async () => {
    const { bindings, database } = await createFixture();
    const files = {
      ".agent/manifest.json": openaiAgentManifest("quiz-master"),
      ".mosoo.toml": `spec = "${MOSOO_NATIVE_SPEC}"\n\n[expose.web]\n`,
      "wrangler.toml": 'main = "worker.js"\n',
      "worker.js": "export default { fetch: () => new Response('ok') };\n",
    };

    const { runRow, state } = await dispatchRepo(bindings, database, files);

    expect(runRow).toMatchObject({
      errorCode: null,
      status: "success",
      targetKind: "cloudflare_worker",
      url: DEPLOY_URL,
    });
    expect(runRow.targetScriptName).toBeTruthy();
    expect(state.buildCount).toBe(1);
    expect(state.deployCount).toBe(1);

    const envVars = state.deployedEnvVars ?? {};

    expect(Object.keys(envVars)).toEqual(["MOSOO_AGENT_URL"]);
    expect(envVars["MOSOO_AGENT_URL"]).toStartWith("https://mosoo.ai/");

    const plan = parsePlanJson(runRow);

    expect(plan["agentBindings"]).toEqual([
      { env: "MOSOO_AGENT_URL", expose: "public_thread", name: "quiz-master" },
    ]);

    const agent = await readAgentRowByName(database, "quiz-master");

    expect(agent?.status).toBe("published");

    const native = parseNativeDeploymentRunResult(runRow.nativeResultJson);

    expect(native?.facts?.web).toEqual({ agent: "quiz-master", declared: true });
  });

  test("fails an [expose.web] static repo with native_web_static_unsupported", async () => {
    const { bindings, database } = await createFixture();

    const { runRow, state } = await dispatchRepo(bindings, database, {
      ".agent/manifest.json": openaiAgentManifest("quiz-master"),
      ".mosoo.toml": `spec = "${MOSOO_NATIVE_SPEC}"\n\n[expose.web]\n`,
      "index.html": "<main>site</main>",
    });

    expect(runRow.status).toBe("failed");
    expect(runRow.errorCode).toBe("native_web_static_unsupported");
    expect(state.buildCount).toBe(0);
    expect(state.deployCount).toBe(0);

    const native = parseNativeDeploymentRunResult(runRow.nativeResultJson);

    expect(native?.validate.valid).toBe(true);
    expect(native?.facts).toBeNull();
    expect(await countAppAgents(database)).toBe(1);
  });
});

describe("repository snapshot widening", () => {
  test("shouldIncludeSnapshotPath keeps legacy basenames and widens to .agent/", () => {
    expect(shouldIncludeSnapshotPath(".mosoo.toml")).toBe(true);
    expect(shouldIncludeSnapshotPath("package.json")).toBe(true);
    expect(shouldIncludeSnapshotPath("apps/web/package.json")).toBe(true);
    expect(shouldIncludeSnapshotPath(".agent/manifest.json")).toBe(true);
    expect(shouldIncludeSnapshotPath(".agent/skills/tips/SKILL.md")).toBe(true);
    expect(shouldIncludeSnapshotPath(".agent/agents/support/manifest.json")).toBe(true);
    expect(shouldIncludeSnapshotPath("src/index.ts")).toBe(false);
    expect(shouldIncludeSnapshotPath(".git/wrangler.toml")).toBe(false);
    expect(shouldIncludeSnapshotPath("vendor/dep/.git/package.json")).toBe(false);
  });

  test("selectRepositorySnapshotPaths caps .agent entries at 512", () => {
    const agentPaths = Array.from(
      { length: 513 },
      (_, index) => `.agent/files/${String(index).padStart(4, "0")}.md`,
    );
    const selected = selectRepositorySnapshotPaths([...agentPaths, "package.json", "src/main.ts"]);

    expect(selected.filter((path) => path.startsWith(".agent/"))).toHaveLength(512);
    expect(selected).toContain(".agent/files/0000.md");
    expect(selected).not.toContain(".agent/files/0512.md");
    expect(selected).toContain("package.json");
    expect(selected).not.toContain("src/main.ts");
  });

  test("admitAgentSnapshotFileContent rejects oversized and non-UTF-8 content", () => {
    expect(admitAgentSnapshotFileContent("hello")).toBe(true);
    expect(admitAgentSnapshotFileContent("x".repeat(2_000_000))).toBe(true);
    expect(admitAgentSnapshotFileContent("x".repeat(2_000_001))).toBe(false);
    expect(admitAgentSnapshotFileContent("binary � payload")).toBe(false);
  });
});
