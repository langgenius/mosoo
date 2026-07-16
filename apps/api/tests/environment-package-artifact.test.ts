import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { apiCommandsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { AppId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import { parseApiCommandPayload } from "../src/modules/api-command/application/api-command-payload";
import { processApiCommandDeadLetterMessage } from "../src/modules/api-command/application/api-command-processor";
import { normalizePackages } from "../src/modules/environments/application/environment-config";
import {
  resolveEnvironmentPackageArtifact,
  resolveReadyEnvironmentPackageArtifact,
} from "../src/modules/environments/application/environment-package-artifact.service";
import { resolveEnvironmentSetupScriptForExecution } from "../src/modules/environments/application/environment-runtime-snapshot";
import { createEnvironmentPackageArtifactKey } from "../src/modules/environments/domain/environment-package-artifact";
import { environmentPackageArtifactSandboxId } from "../src/modules/environments/domain/environment-package-artifact";
import { exposeEnvironmentNodeModules } from "../src/modules/runtime/infrastructure/runtime-sandbox-provisioning/runtime-environment-artifact";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createApiCommandQueueStub,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  createRecordedQueueMessage,
  PublicApiMemoryFileBucket,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";

const APP_ID = parsePlatformId<AppId>("01J0000000000000000000000A", "app id");

describe("Environment package artifacts", () => {
  test("configures the Sandbox SDK backup bucket in local and production", () => {
    const wrangler = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");

    expect(wrangler.match(/^binding = "BACKUP_BUCKET"$/gmu)).toHaveLength(2);
    expect(wrangler.match(/^BACKUP_BUCKET_NAME = "mosoo-sandbox-state"$/gmu)).toHaveLength(2);
  });

  test("normalizes pinned npm and pip packages into a stable artifact key", async () => {
    const packages = normalizePackages([
      { manager: "pip", packages: ["requests==2.32.4", "jsonschema==4.25.1"] },
      { manager: "npm", packages: ["zod@4.3.6", "zod@4.3.6"] },
    ]);
    const key = await createEnvironmentPackageArtifactKey({
      appId: APP_ID,
      artifactAbi: "environment-artifact-v1",
      packages,
    });

    expect(packages).toEqual([
      { manager: "npm", packages: ["zod@4.3.6"] },
      { manager: "pip", packages: ["jsonschema==4.25.1", "requests==2.32.4"] },
    ]);
    expect(key.inputDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(environmentPackageArtifactSandboxId(key).length).toBeLessThanOrEqual(63);
    expect(
      parseApiCommandPayload(
        "environment_package_artifact_build",
        JSON.stringify({ ...key, artifactAbi: "environment-artifact-v1", packages }),
      ),
    ).toEqual({ ...key, artifactAbi: "environment-artifact-v1", packages });
  });

  test.each([
    ["apt", "curl"],
    ["pip", "requests>=2"],
    ["npm", "zod@latest"],
  ] as const)("rejects unsupported package %s %s", (manager, spec) => {
    expect(() => normalizePackages([{ manager, packages: [spec] }])).toThrow();
  });

  test("surfaces terminal build failure until an explicit Environment save retries it", async () => {
    const database = await createPublicHttpContractDatabase();
    const artifactQueue = createApiCommandQueueStub();
    const bindings = {
      ...createPublicHttpTestBindings(database),
      ENVIRONMENT_ARTIFACT_BUILD_QUEUE: artifactQueue,
      SANDBOX_STATE_BUCKET: new PublicApiMemoryFileBucket(),
    } as ApiBindings;
    const packages = [{ manager: "pip", packages: ["missing-package==1.0.0"] }] as const;

    await expect(
      resolveReadyEnvironmentPackageArtifact(bindings, APP_ID, JSON.stringify(packages)),
    ).rejects.toMatchObject({ code: "ENVIRONMENT_ARTIFACT_PREPARING" });
    const [command] = await database.app().select().from(apiCommandsTable).all();
    if (!command) {
      throw new Error("Expected artifact command.");
    }
    await database
      .app()
      .update(apiCommandsTable)
      .set({
        lastErrorCode: "package_install_failed",
        lastErrorMessage: "Package installation failed.",
      })
      .where(eq(apiCommandsTable.id, command.id))
      .run();
    const queued = artifactQueue.sent[0];
    if (!queued) {
      throw new Error("Expected queued artifact command.");
    }
    await processApiCommandDeadLetterMessage(
      bindings,
      createRecordedQueueMessage({ body: queued.body }).message,
    );

    await expect(
      resolveReadyEnvironmentPackageArtifact(bindings, APP_ID, JSON.stringify(packages)),
    ).rejects.toMatchObject({
      code: "ENVIRONMENT_ARTIFACT_FAILED",
      message: "Package installation failed.",
    });
    expect(artifactQueue.sent).toHaveLength(1);

    await resolveEnvironmentPackageArtifact(bindings, APP_ID, packages, { retryFailed: true });
    expect(artifactQueue.sent).toHaveLength(2);
    await expect(
      database
        .app()
        .select()
        .from(apiCommandsTable)
        .where(eq(apiCommandsTable.id, command.id))
        .get(),
    ).resolves.toMatchObject({ status: "queued" });
  });

  test("uses the exact Environment revision custom script for legacy snapshots", async () => {
    const database = await createPublicHttpContractDatabase();
    await database
      .prepare("UPDATE environment_revision SET setup_script = ? WHERE id = ?")
      .bind("echo custom", PUBLIC_API_TEST_IDS.environmentRevision)
      .run();

    await expect(
      resolveEnvironmentSetupScriptForExecution(database, {
        packagesJson: JSON.stringify([{ manager: "pip", packages: ["requests==2.32.4"] }]),
        revisionId: PUBLIC_API_TEST_IDS.environmentRevision,
        setupScript: "pip install 'requests==2.32.4'\n\necho custom",
      }),
    ).resolves.toBe("echo custom");
  });

  test("exposes restored npm packages through standard ESM resolution", async () => {
    const root = mkdtempSync(join(tmpdir(), "mosoo-environment-artifact-"));
    const packageRoot = join(root, "artifact/npm/node_modules/@example/sdk");
    const sessionRoot = join(root, "session");
    mkdirSync(packageRoot, { recursive: true });
    mkdirSync(sessionRoot);
    writeFileSync(
      join(packageRoot, "package.json"),
      JSON.stringify({ exports: "./index.js", name: "@example/sdk", type: "module" }),
    );
    writeFileSync(join(packageRoot, "index.js"), "export const ready = true;\n");
    const session = {
      exec: async (command: string) => {
        execFileSync("sh", ["-lc", command]);
        return { exitCode: 0, stderr: "", stdout: "", success: true };
      },
    };

    try {
      await exposeEnvironmentNodeModules(session, {
        nodePaths: [join(root, "artifact/npm/node_modules")],
        organizationPath: sessionRoot,
      });
      expect(
        execFileSync(
          process.execPath,
          ["--input-type=module", "-e", 'import("@example/sdk").then(m=>console.log(m.ready))'],
          { cwd: sessionRoot, encoding: "utf8" },
        ).trim(),
      ).toBe("true");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
