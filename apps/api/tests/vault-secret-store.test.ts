import { describe, expect, test } from "bun:test";

import {
  deleteSecret,
  readSecret,
  storeSecret,
} from "../src/modules/vault/application/vault-secret-store";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

describe("vault secret store", () => {
  test("encrypts secrets at rest and deletes them idempotently", async () => {
    const database = new SqliteD1Database({ foreignKeys: false });
    database.execute(`
      CREATE TABLE vault_secret (
        algorithm text NOT NULL DEFAULT 'AES-GCM',
        ciphertext text NOT NULL,
        ciphertext_iv text NOT NULL,
        created_at integer NOT NULL,
        id text PRIMARY KEY NOT NULL,
        kind text NOT NULL,
        updated_at integer NOT NULL,
        wrapped_dek text NOT NULL,
        wrapped_dek_iv text NOT NULL
      );
    `);
    const bindings = { DB: database, VAULT_ROOT_SECRET: "test-root-secret" } as ApiBindings;

    const secretId = await storeSecret(database, bindings, {
      kind: "vendor_api_key",
      value: "sk-plaintext",
    });
    const stored = await database
      .prepare("SELECT ciphertext FROM vault_secret WHERE id = ?")
      .bind(secretId)
      .first<string>("ciphertext");

    expect(stored).not.toBeNull();
    expect(stored).not.toContain("sk-plaintext");
    await expect(readSecret(database, bindings, secretId)).resolves.toBe("sk-plaintext");

    await deleteSecret(database, secretId);
    await deleteSecret(database, secretId);

    await expect(readSecret(database, bindings, secretId)).rejects.toThrow("Secret not found.");
  });
});
