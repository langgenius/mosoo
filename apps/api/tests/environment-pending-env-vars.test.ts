import { describe, expect, test } from "bun:test";

import { vaultSecretsTable } from "@mosoo/db";
import { eq } from "drizzle-orm";

import {
  buildStoredEnvVars,
  decryptEnvironmentVariables,
  parseStoredEnvVarsJson,
  toPublicRevisionConfig,
} from "../src/modules/environments/application/environment-config";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
} from "./helpers/public-api-http-test-fixture";

describe("Environment pending env vars", () => {
  test("allows creating an Environment env var placeholder without a secret value", async () => {
    const envVars = await buildStoredEnvVars({} as ApiBindings, {
      envVars: [{ key: "LINEAR_API_KEY", value: null }],
    });

    expect(envVars).toEqual([
      {
        key: "LINEAR_API_KEY",
        preview: "",
        secretId: null,
      },
    ]);
    expect(
      toPublicRevisionConfig({
        allowedHosts: ["api.linear.app"],
        envVars,
        networkPolicy: "limited",
        packages: [],
        setupScript: "",
      }).envVars,
    ).toEqual([{ key: "LINEAR_API_KEY", preview: "", status: "pending" }]);
  });

  test("parses pending env vars and refuses to decrypt them for runtime snapshots", async () => {
    const envVars = parseStoredEnvVarsJson(
      JSON.stringify([{ key: "LINEAR_API_KEY", preview: "", secretId: null }]),
    );

    await expect(decryptEnvironmentVariables({} as ApiBindings, envVars)).rejects.toThrow();
  });

  test("decrypts env var secrets and fails explicitly once a secret is gone", async () => {
    const database = await createPublicHttpContractDatabase();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const envVars = await buildStoredEnvVars(bindings, {
      envVars: [{ key: "LINEAR_API_KEY", value: "linear-secret" }],
    });
    const secretId = envVars[0]?.secretId;

    if (secretId === null || secretId === undefined) {
      throw new Error("Expected configured Environment env var to store a secret.");
    }

    await expect(decryptEnvironmentVariables(bindings, envVars)).resolves.toEqual({
      LINEAR_API_KEY: "linear-secret",
    });

    await database.app().delete(vaultSecretsTable).where(eq(vaultSecretsTable.id, secretId)).run();

    await expect(decryptEnvironmentVariables(bindings, envVars)).rejects.toThrow();
  });
});
