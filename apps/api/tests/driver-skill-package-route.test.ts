import { describe, expect, test } from "bun:test";

import { skillSnapshotsTable } from "@mosoo/db";
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
const SKILL_BLOB_KEY = "project/01J0000000000000000000000Q/skill-blob/test.skill";

function createDriverRouteTestApp(): Hono<ApiGatewayEnvironment> {
  const app = new Hono<ApiGatewayEnvironment>();
  registerDriverRoute(app);
  return app;
}

async function insertSkillSnapshot(
  database: Awaited<ReturnType<typeof createPublicHttpContractDatabase>>,
) {
  await database
    .app()
    .insert(skillSnapshotsTable)
    .values({
      projectId: PUBLIC_API_TEST_IDS.project,
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
  test("downloads the skill package named by the signed grant", async () => {
    const database = await createPublicHttpContractDatabase();
    const bucket = new PublicApiMemoryFileBucket();
    const bindings = createPublicHttpTestBindings(database, {
      fileBucket: bucket as unknown as R2Bucket,
    }) as ApiBindings;

    await insertSkillSnapshot(database);
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

  test("still rejects grants for a different skill snapshot", async () => {
    const database = await createPublicHttpContractDatabase();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

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
