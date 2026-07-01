import { describe, expect, test } from "bun:test";

import { driverInstancesTable, skillSnapshotsTable } from "@mosoo/db";
import { Hono } from "hono";

import { registerDriverRoute } from "../src/adapters/http/routes/driver-route";
import { getRuntimeDriverSkillPackagePath } from "../src/modules/runtime/domain/runtime-driver-routes";
import { createRuntimeActionToken } from "../src/modules/runtime/infrastructure/runtime-boot-token";
import type { ApiBindings, ApiGatewayEnvironment } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS,
  PublicApiMemoryFileBucket,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  createTestExecutionContext,
  nowMsForTest,
} from "./helpers/public-api-http-test-fixture";

const SKILL_SNAPSHOT_ID = "01J0000000000000000000000S";
const OTHER_SKILL_SNAPSHOT_ID = "01J0000000000000000000000T";
const SKILL_BLOB_KEY = "app/01J0000000000000000000000Q/skill-blob/test.skill";

function ensureSkillRouteTables(
  database: Awaited<ReturnType<typeof createPublicHttpContractDatabase>>,
) {
  database.execute(`
    CREATE TABLE IF NOT EXISTS skill_snapshot (
      author text NOT NULL,
      blob_key text NOT NULL,
      blob_sha256 text NOT NULL,
      blob_size integer NOT NULL,
      created_at integer NOT NULL,
      description text NOT NULL,
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      app_id text NOT NULL,
      skill_markdown_path text NOT NULL,
      uncompressed_size integer NOT NULL,
      version text
    );

    CREATE TABLE IF NOT EXISTS session_run_skill (
      blob_sha256 text,
      created_at integer NOT NULL,
      materialization_status text NOT NULL,
      mount_path text NOT NULL,
      resolution_mode text NOT NULL,
      session_run_id text NOT NULL,
      skill_id text NOT NULL,
      skill_name text NOT NULL,
      snapshot_id text,
      updated_at integer NOT NULL,
      warning_code text,
      PRIMARY KEY (session_run_id, skill_id)
    );
  `);
}

function createDriverRouteTestApp(): Hono<ApiGatewayEnvironment> {
  const app = new Hono<ApiGatewayEnvironment>();
  registerDriverRoute(app);
  return app;
}

async function insertSkillSnapshot(database: Awaited<ReturnType<typeof createPublicHttpContractDatabase>>) {
  await database
    .app()
    .insert(skillSnapshotsTable)
    .values({
      appId: PUBLIC_API_TEST_IDS.app,
      author: "Skill Author",
      blobKey: SKILL_BLOB_KEY,
      blobSha256: "sha-skill",
      blobSize: "skill-zip".length,
      createdAt: nowMsForTest(),
      description: "Skill package route test.",
      id: SKILL_SNAPSHOT_ID,
      name: "route-skill",
      skillMarkdownPath: "SKILL.md",
      uncompressedSize: 10,
      version: null,
    })
    .run();
}

async function insertDriverInstance(
  database: Awaited<ReturnType<typeof createPublicHttpContractDatabase>>,
  status: "provisioning" | "connecting" | "ready",
) {
  const nowMs = Date.now();
  await database
    .app()
    .insert(driverInstancesTable)
    .values({
      bootTokenExpiresAt: nowMs + 60_000,
      bootTokenHash: new Uint8Array([1, 2, 3]),
      bootTokenUsedAt: null,
      closeCode: null,
      closeReason: null,
      connectionId: null,
      createdAt: nowMs,
      driverPid: null,
      driverStartedAt: null,
      driverVersion: null,
      errorMessage: null,
      expiresAt: nowMs + 60_000,
      heartbeatCount: 0,
      id: PUBLIC_API_TEST_IDS.driverOwner,
      lastHeartbeatAt: null,
      processId: null,
      protocol: "orpc-ws",
      protocolVersion: 1,
      runtime: "openai-runtime",
      sandboxId: PUBLIC_API_TEST_IDS.sandbox,
      sandboxSessionId: PUBLIC_API_TEST_IDS.ownerSession,
      status,
      statusChangedAt: nowMs,
      statusSource: "api",
      updatedAt: nowMs,
    })
    .run();
}

async function createSkillDownloadRequest(
  bindings: ApiBindings,
  snapshotId = SKILL_SNAPSHOT_ID,
  resourceId = SKILL_SNAPSHOT_ID,
): Promise<Request> {
  const grant = await createRuntimeActionToken(bindings, {
    action: "skill_snapshot",
    driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner,
    expiresAt: Date.now() + 60_000,
    resourceId,
  });
  return new Request(
    `https://api.example.com${getRuntimeDriverSkillPackagePath(snapshotId)}?grant=${grant}`,
  );
}

describe("driver skill package route", () => {
  test("allows startup driver skill package downloads before the run lease is linked", async () => {
    const database = await createPublicHttpContractDatabase();
    const bucket = new PublicApiMemoryFileBucket();
    const bindings = createPublicHttpTestBindings(database, {
      fileBucket: bucket as unknown as R2Bucket,
    }) as ApiBindings;

    ensureSkillRouteTables(database);
    await insertSkillSnapshot(database);
    await insertDriverInstance(database, "provisioning");
    await bucket.put(SKILL_BLOB_KEY, "skill-zip");

    const response = await createDriverRouteTestApp().request(
      await createSkillDownloadRequest(bindings),
      undefined,
      bindings,
      createTestExecutionContext(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(await response.text()).toBe("skill-zip");
  });

  test("does not allow ready drivers without a run lease to download skills", async () => {
    const database = await createPublicHttpContractDatabase();
    const bucket = new PublicApiMemoryFileBucket();
    const bindings = createPublicHttpTestBindings(database, {
      fileBucket: bucket as unknown as R2Bucket,
    }) as ApiBindings;

    ensureSkillRouteTables(database);
    await insertSkillSnapshot(database);
    await insertDriverInstance(database, "ready");
    await bucket.put(SKILL_BLOB_KEY, "skill-zip");

    const response = await createDriverRouteTestApp().request(
      await createSkillDownloadRequest(bindings),
      undefined,
      bindings,
      createTestExecutionContext(),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Snapshot is not available for this driver instance.",
    });
  });

  test("still rejects grants for a different skill snapshot", async () => {
    const database = await createPublicHttpContractDatabase();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    ensureSkillRouteTables(database);
    await insertDriverInstance(database, "provisioning");

    const response = await createDriverRouteTestApp().request(
      await createSkillDownloadRequest(bindings, SKILL_SNAPSHOT_ID, OTHER_SKILL_SNAPSHOT_ID),
      undefined,
      bindings,
      createTestExecutionContext(),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Runtime action grant does not match this skill snapshot.",
    });
  });
});
