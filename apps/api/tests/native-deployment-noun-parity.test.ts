import { describe, expect, test } from "bun:test";

import type { AppDeploymentRun } from "@mosoo/contracts/app";
import { NATIVE_REPO_MULTI_AGENT_FILES } from "@mosoo/contracts/native-repo-fixtures";
import type { AppDeploymentRunRow } from "@mosoo/db";
import { appDeploymentRunsTable, vendorCredentialsTable } from "@mosoo/db";
import type { AppId, OrganizationId, VendorCredentialId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import type { AppDeploymentBuildRunner } from "../src/modules/apps/application/app-deployment-executor.service";
import { dispatchAppDeploymentRun } from "../src/modules/apps/application/app-deployment-executor.service";
import {
  deployApp,
  getAppDeploymentStatus,
  listAppDeploymentRuns,
} from "../src/modules/apps/application/app-deployment.service";
import { listOrganizationApps } from "../src/modules/apps/application/app.service";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { storeVendorCredentialSecret } from "../src/modules/vendor-credentials/application/vendor-credential.secret-resolution";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS,
  PublicApiMemoryFileBucket,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  nowMsForTest,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/sqlite-d1";
import { withProviderProbeMock } from "./public-thread-api-fixtures";

const APP_ID = PUBLIC_API_TEST_IDS.app as AppId;
const ORGANIZATION_ID = PUBLIC_API_TEST_IDS.organization as OrganizationId;
const ANTHROPIC_VENDOR_CREDENTIAL_ID = "vendor-anthropic-app" as VendorCredentialId;
const GREEN_MULTI_AGENT_FILES = Object.freeze(NATIVE_REPO_MULTI_AGENT_FILES);
const EXPECTED_AGENT_FACTS = [
  { action: "created", exposed: true, name: "concierge", versionNumber: 1 },
  { action: "created", exposed: true, name: "support", versionNumber: 1 },
  { action: "created", exposed: false, name: "triage", versionNumber: 1 },
] as const;
const EXPECTED_EXPOSED_AGENT_NAMES = ["concierge", "support"] as const;

const OWNER_VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: PUBLIC_API_TEST_IDS.ownerAccount,
  imageUrl: null,
  name: "Owner",
};

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

interface NativeDeployInstance {
  bindings: ApiBindings;
  database: SqliteD1Database;
}

function createFakeRunner(files: Readonly<Record<string, string>>): AppDeploymentBuildRunner {
  return {
    async build() {},
    async deploy() {
      return {
        externalDeploymentId: "external-deploy-1",
        externalProjectId: null,
        externalVersionId: "external-version-1",
        url: "https://deployed.example",
      };
    },
    async prepare() {
      return { repoDir: "/repo", snapshot: { files } };
    },
  };
}

async function createNativeDeployInstance(): Promise<NativeDeployInstance> {
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

  await seedAnthropicVendorCredential(bindings, database);
  await removeSeededAgents(database);

  return { bindings, database };
}

async function seedAnthropicVendorCredential(
  bindings: ApiBindings,
  database: SqliteD1Database,
): Promise<void> {
  const apiKeySecretId = await storeVendorCredentialSecret(bindings, {
    apiKey: "sk-ant-test",
    credentialId: ANTHROPIC_VENDOR_CREDENTIAL_ID,
    appId: APP_ID,
    providerId: "anthropic",
    purpose: "credential_create_api_key",
  });

  await database
    .app()
    .insert(vendorCredentialsTable)
    .values({
      apiBase: null,
      apiKeySecretId,
      createdAt: nowMsForTest(),
      id: ANTHROPIC_VENDOR_CREDENTIAL_ID,
      models: null,
      name: "App Anthropic",
      appId: APP_ID,
      updatedAt: nowMsForTest(),
      vendorId: "anthropic",
    })
    .run();
}

async function removeSeededAgents(database: SqliteD1Database): Promise<void> {
  await database
    .prepare("DELETE FROM agent_deployment_version WHERE agent_id IN (SELECT id FROM agent)")
    .run();
  await database.prepare("DELETE FROM agent").run();
}

async function deployGreenNativeRepo(instance: NativeDeployInstance): Promise<{
  queuedRun: AppDeploymentRun;
  runRow: AppDeploymentRunRow;
}> {
  const queuedRun = await deployApp(
    instance.bindings,
    OWNER_VIEWER,
    { appId: APP_ID, repoUrl: "https://github.com/samzong/awire" },
    { fetch: githubFetch, nowMs: nowMsForTest },
  );

  await withProviderProbeMock(() =>
    dispatchAppDeploymentRun(
      instance.bindings,
      { appDeploymentRunId: queuedRun.id },
      {
        runner: createFakeRunner(GREEN_MULTI_AGENT_FILES),
      },
    ),
  );

  const runRow = await instance.database
    .app()
    .select()
    .from(appDeploymentRunsTable)
    .where(eq(appDeploymentRunsTable.id, queuedRun.id))
    .limit(1)
    .get();

  if (runRow === undefined) {
    throw new Error("Deployment run row missing after dispatch.");
  }

  return { queuedRun, runRow };
}

function assertGreenRunNouns(run: AppDeploymentRun, expectedRunId: string): void {
  expect(run).toMatchObject({
    appId: APP_ID,
    errorCode: null,
    errorMessage: null,
    id: expectedRunId,
    liveUrl: null,
    sourceBranch: "main",
    sourceCommitSha: "abc123",
    status: "success",
    targetKind: null,
  });

  if (run.native === null) {
    throw new Error("Expected native run result on green protocol run.");
  }

  if (run.native.facts === null) {
    throw new Error("Expected native facts on green protocol run.");
  }

  expect(run.native.facts).toEqual({
    agentCount: 3,
    agents: EXPECTED_AGENT_FACTS,
    specVersion: "mosoo.spec.v1",
    web: { declared: false },
  });
  expect(run.native.validate.valid).toBe(true);
  expect(
    run.native.facts.agents.map((agent) => ({
      action: agent.action,
      exposed: agent.exposed,
      name: agent.name,
    })),
  ).toEqual([
    { action: "created", exposed: true, name: "concierge" },
    { action: "created", exposed: true, name: "support" },
    { action: "created", exposed: false, name: "triage" },
  ]);
}

async function readAppSlug(instance: NativeDeployInstance): Promise<string> {
  const apps = await listOrganizationApps(instance.bindings.DB, OWNER_VIEWER, ORGANIZATION_ID);
  const app = apps.find((candidate) => candidate.id === APP_ID);

  expect(app?.slug).toBe("default-app");

  if (app?.slug === undefined || app.slug === null) {
    throw new Error("Expected minted App slug.");
  }

  return app.slug;
}

function readExposedAgentNames(run: AppDeploymentRun): string[] {
  const facts = run.native?.facts;

  if (facts === undefined || facts === null) {
    throw new Error("Expected native facts.");
  }

  return facts.agents.filter((agent) => agent.exposed).map((agent) => agent.name);
}

describe("native deployment noun parity", () => {
  test("pins the green deploy response nouns consumed by CLI overlays", async () => {
    const instance = await createNativeDeployInstance();
    const { queuedRun, runRow } = await deployGreenNativeRepo(instance);

    expect(queuedRun).toMatchObject({
      appId: APP_ID,
      errorCode: null,
      id: queuedRun.id,
      native: null,
      sourceBranch: "main",
      sourceCommitSha: "abc123",
      status: "queued",
    });
    expect(runRow).toMatchObject({
      errorCode: null,
      id: queuedRun.id,
      nativeResultJson: expect.any(String),
      sourceCommitSha: "abc123",
      status: "success",
    });

    const status = await getAppDeploymentStatus(instance.bindings, OWNER_VIEWER, APP_ID);

    if (status === null) {
      throw new Error("Expected deployment status after green run.");
    }

    const runs = await listAppDeploymentRuns(instance.bindings, OWNER_VIEWER, APP_ID, 10);
    const latestRun = runs[0];

    if (latestRun === undefined) {
      throw new Error("Expected listed deployment run after green run.");
    }

    assertGreenRunNouns(status, queuedRun.id);
    assertGreenRunNouns(latestRun, queuedRun.id);

    const slug = await readAppSlug(instance);
    const exposedNames = readExposedAgentNames(status);

    expect(exposedNames).toEqual(EXPECTED_EXPOSED_AGENT_NAMES);
    expect(exposedNames.map((name) => `/api/v1/apps/${slug}/agents/${name}/threads`)).toEqual([
      "/api/v1/apps/default-app/agents/concierge/threads",
      "/api/v1/apps/default-app/agents/support/threads",
    ]);

    // US-17: the deploy status/list nouns carry the App OpenAPI URL, derived
    // from the minted slug, so the CLI/console can point users at it.
    const expectedOpenApiUrl = `https://mosoo.ai/api/v1/apps/${slug}/openapi.json`;

    expect(status.appOpenApiUrl).toBe(expectedOpenApiUrl);
    expect(latestRun.appOpenApiUrl).toBe(expectedOpenApiUrl);
  });
});
