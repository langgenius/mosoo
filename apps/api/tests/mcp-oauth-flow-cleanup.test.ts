import { describe, expect, spyOn, test } from "bun:test";

import { mcpOauthFlowsTable, vaultSecretsTable } from "@mosoo/db";
import { inArray } from "drizzle-orm";

import {
  destroyOAuthFlowArtifactsBatch,
  markOAuthFlowTerminal,
} from "../src/modules/mcp/application/mcp-oauth-flow.repository";
import {
  createPublicHttpContractDatabase,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/sqlite-d1";

const KEPT = {
  id: "01J00000000000000000000F01",
  oauthClientSecretSecretId: "01J00000000000000000000S01",
};
const FAILING = {
  id: "01J00000000000000000000F02",
  oauthClientSecretSecretId: "01J00000000000000000000S02",
};

async function fixture() {
  const database = await createPublicHttpContractDatabase();
  const flows = [KEPT, FAILING];
  await database
    .app()
    .insert(vaultSecretsTable)
    .values(
      flows.map((flow) => ({
        ciphertext: "ciphertext",
        ciphertextIv: "iv",
        createdAt: 1,
        id: flow.oauthClientSecretSecretId,
        kind: "mcp_oauth_flow_client_secret",
        updatedAt: 1,
        wrappedDek: "dek",
        wrappedDekIv: "dek-iv",
      })),
    )
    .run();
  await database
    .app()
    .insert(mcpOauthFlowsTable)
    .values(
      flows.map((flow) => ({
        authorizationEndpoint: "https://auth.example.com/authorize",
        cleanupAfter: 1,
        codeVerifier: "verifier",
        createdAt: 1,
        expiresAt: 1,
        id: flow.id,
        initiatorUserId: PUBLIC_API_TEST_IDS.ownerAccount,
        oauthClientId: "client",
        oauthClientSecretSecretId: flow.oauthClientSecretSecretId,
        projectId: PUBLIC_API_TEST_IDS.project,
        serverId: "01J00000000000000000000V01",
        status: "pending" as const,
        tokenEndpoint: "https://auth.example.com/token",
        updatedAt: 1,
      })),
    )
    .run();
  return database;
}

// Fails the vault delete of FAILING's secret, as a transient D1 error would.
function failingSecretDelete(database: SqliteD1Database): D1Database {
  return new Proxy(database, {
    get(target, property) {
      if (property !== "prepare") {
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      }

      return (query: string) => {
        const statement = target.prepare(query);

        return query.startsWith('delete from "vault_secret"')
          ? {
              bind: (...values: unknown[]) =>
                values.includes(FAILING.oauthClientSecretSecretId)
                  ? { run: async () => Promise.reject(new Error("D1 is unavailable.")) }
                  : statement.bind(...values),
            }
          : statement;
      };
    },
  });
}

async function remaining(database: SqliteD1Database) {
  const flows = await database
    .app()
    .select({
      id: mcpOauthFlowsTable.id,
      secretId: mcpOauthFlowsTable.oauthClientSecretSecretId,
      status: mcpOauthFlowsTable.status,
    })
    .from(mcpOauthFlowsTable)
    .all();
  const secrets = await database
    .app()
    .select({ id: vaultSecretsTable.id })
    .from(vaultSecretsTable)
    .where(
      inArray(vaultSecretsTable.id, [
        KEPT.oauthClientSecretSecretId,
        FAILING.oauthClientSecretSecretId,
      ]),
    )
    .all();

  return { flows, secrets: secrets.map((row) => row.id) };
}

describe("MCP OAuth flow cleanup", () => {
  test("keeps a flow whose client secret delete fails for the next cleanup", async () => {
    const database = await fixture();
    const logged = spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        destroyOAuthFlowArtifactsBatch(failingSecretDelete(database), [KEPT, FAILING]),
      ).resolves.toBeUndefined();
    } finally {
      logged.mockRestore();
    }

    expect(await remaining(database)).toEqual({
      flows: [{ id: FAILING.id, secretId: FAILING.oauthClientSecretSecretId, status: "pending" }],
      secrets: [FAILING.oauthClientSecretSecretId],
    });

    await destroyOAuthFlowArtifactsBatch(database, [FAILING]);
    expect(await remaining(database)).toEqual({ flows: [], secrets: [] });
  });

  test("keeps the secret reference when finishing a flow cannot delete the secret", async () => {
    const database = await fixture();
    const terminal = { errorMessage: null, status: "succeeded" as const, subjectLabel: null };

    await expect(
      markOAuthFlowTerminal(failingSecretDelete(database), FAILING, terminal),
    ).rejects.toThrow();
    expect((await remaining(database)).flows).toContainEqual({
      id: FAILING.id,
      secretId: FAILING.oauthClientSecretSecretId,
      status: "pending",
    });

    await markOAuthFlowTerminal(database, FAILING, terminal);
    expect((await remaining(database)).flows).toContainEqual({
      id: FAILING.id,
      secretId: null,
      status: "succeeded",
    });
    expect((await remaining(database)).secrets).toEqual([KEPT.oauthClientSecretSecretId]);
  });
});
