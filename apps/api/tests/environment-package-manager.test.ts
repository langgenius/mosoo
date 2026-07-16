import { describe, expect, test } from "bun:test";

import type {
  EnvironmentConfigInput,
  EnvironmentPackageManager,
} from "@mosoo/contracts/environment";
import { createPlatformId } from "@mosoo/id";
import type { EnvironmentId, AppId } from "@mosoo/id";

import {
  normalizeEnvironmentConfigInput,
  parsePackagesJson,
} from "../src/modules/environments/application/environment-config";
import { resolveReadyEnvironmentPackageArtifact } from "../src/modules/environments/application/environment-package-artifact.service";
import type { EnvironmentMutableConfig } from "../src/modules/environments/application/environment-types";
import {
  createEnvironmentFromConfig,
  createRevision,
} from "../src/modules/environments/application/environment-write.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const LEGACY_MANAGERS = [
  "apt",
  "cargo",
  "gem",
  "go",
] as const satisfies readonly EnvironmentPackageManager[];

function configWithPackage(manager: EnvironmentPackageManager): EnvironmentConfigInput {
  return {
    allowMcpServers: true,
    allowPackageManagers: true,
    allowedHosts: [],
    envVars: [],
    networkPolicy: "full",
    packages: [{ manager, packages: ["example@1.0.0"] }],
    setupScript: "",
  };
}

function storedConfigWithPackage(manager: EnvironmentPackageManager): EnvironmentMutableConfig {
  return {
    ...configWithPackage(manager),
    envVars: [],
  };
}

function createEnvironmentWriteDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE environment (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      description text NOT NULL,
      app_id text NOT NULL,
      owner_account_id text,
      current_revision_id text NOT NULL,
      forked_from_environment_id text,
      forked_from_environment_name text,
      forked_from_owner_name text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE environment_revision (
      id text PRIMARY KEY NOT NULL,
      environment_id text NOT NULL,
      app_id text NOT NULL,
      network_policy text NOT NULL,
      allow_mcp_servers integer NOT NULL,
      allow_package_managers integer NOT NULL,
      allowed_hosts_json text NOT NULL,
      packages_json text NOT NULL,
      setup_script text NOT NULL,
      env_vars_json text NOT NULL,
      created_by_account_id text,
      created_at integer NOT NULL
    );
  `);

  return database;
}

describe("Environment package managers", () => {
  test("reads package managers retained by existing Environment revisions", () => {
    const parsed = parsePackagesJson(
      JSON.stringify(LEGACY_MANAGERS.map((manager) => ({ manager, packages: ["legacy"] }))),
    );

    expect(parsed.map((entry) => entry.manager)).toEqual(LEGACY_MANAGERS);
  });

  test.each(LEGACY_MANAGERS)("rejects new %s writes with an actionable error", (manager) => {
    expect(() => normalizeEnvironmentConfigInput(configWithPackage(manager))).toThrow(
      `Package manager ${manager} is not supported by the current Driver runtime. Remove it or replace it with npm or pip before saving.`,
    );
  });

  test.each(LEGACY_MANAGERS)(
    "rejects a frozen %s revision before artifact infrastructure access",
    async (manager) => {
      let bindingAccessed = false;
      const bindings = new Proxy({} as ApiBindings, {
        get() {
          bindingAccessed = true;
          throw new Error("Artifact infrastructure must not be accessed.");
        },
      });

      await expect(
        resolveReadyEnvironmentPackageArtifact(
          bindings,
          createPlatformId<AppId>(),
          JSON.stringify([{ manager, packages: ["legacy"] }]),
        ),
      ).rejects.toThrow(
        `Package manager ${manager} is not supported by the current Driver runtime. Remove it or replace it with npm or pip before saving.`,
      );
      expect(bindingAccessed).toBe(false);
    },
  );

  test("guards both revision persistence boundaries against bypass writes", async () => {
    const database = createEnvironmentWriteDatabase();
    const environmentId = createPlatformId<EnvironmentId>();
    const appId = createPlatformId<AppId>();
    const config = storedConfigWithPackage("cargo");
    const expected =
      "Package manager cargo is not supported by the current Driver runtime. Remove it or replace it with npm or pip before saving.";

    await expect(
      createRevision(
        { DB: database },
        {
          actorId: null,
          config,
          environmentId,
          appId,
          timestampMs: 1,
        },
      ),
    ).rejects.toThrow(expected);
    await expect(
      createEnvironmentFromConfig(
        { DB: database },
        {
          actorId: null,
          config,
          description: "",
          environmentId,
          name: "legacy",
          ownerId: null,
          appId,
          timestampMs: 1,
        },
      ),
    ).rejects.toThrow(expected);
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM environment")
        .first<{ count: number }>(),
    ).toEqual({ count: 0 });
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM environment_revision")
        .first<{ count: number }>(),
    ).toEqual({ count: 0 });
  });
});
