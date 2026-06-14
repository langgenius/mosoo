import { describe, expect, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { OrganizationId, PlatformId, AppId, VendorCredentialId } from "@mosoo/id";

import { readSecretOutcome } from "../src/modules/mcp/application/mcp-secret-store";
import {
  collectAvailableVendorIds,
  deleteVendorCredentialSecret,
  getVendorCredentialSecretReadDenial,
  readVendorCredentialSecret,
  storeVendorCredentialSecret,
} from "../src/modules/vendor-credentials/application/vendor-credential.secret-resolution";
import type { VendorCredentialRow } from "../src/modules/vendor-credentials/application/vendor-credential.types";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const ORGANIZATION_ID = parsePlatformId<OrganizationId>(
  "01J00000000000000000000006",
  "organization ID",
);
const APP_ID = parsePlatformId<AppId>("01J00000000000000000000009", "app ID");
const OTHER_APP_ID = parsePlatformId<AppId>("01J0000000000000000000000A", "other app ID");
const CREDENTIAL_ID = parsePlatformId<VendorCredentialId>(
  "01J0000000000000000000000B",
  "credential ID",
);
const OTHER_CREDENTIAL_ID = parsePlatformId<VendorCredentialId>(
  "01J0000000000000000000000C",
  "other credential ID",
);

function createSecretDatabase(): SqliteD1Database {
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

  return database;
}

function createBindings(database: D1Database): ApiBindings {
  return {
    DB: database,
    VAULT_ROOT_SECRET: "test-root-secret",
  } as ApiBindings;
}

function createCredentialRow(input: {
  credentialId?: VendorCredentialId;
  onReadVendorId?: () => void;
  appId?: AppId;
  secretId?: PlatformId;
  vendorId: string;
}): VendorCredentialRow {
  const row = {
    apiBase: null,
    apiKeySecretId: input.secretId ?? `${input.vendorId}-secret`,
    id: input.credentialId ?? CREDENTIAL_ID,
    modelsJson: null,
    name: `${input.vendorId} credential`,
    organizationId: ORGANIZATION_ID,
    appId: input.appId ?? APP_ID,
  } as VendorCredentialRow;

  Object.defineProperty(row, "vendorId", {
    enumerable: true,
    get() {
      input.onReadVendorId?.();
      return input.vendorId;
    },
  });

  return row;
}

describe("vendor credential secret resolution", () => {
  test("returns typed App denial outcomes before reading storage", async () => {
    const row = createCredentialRow({
      appId: OTHER_APP_ID,
      vendorId: "openai",
    });

    const outcome = await readVendorCredentialSecret(
      {
        DB: {} as D1Database,
        VAULT_ROOT_SECRET: "unused",
      },
      {
        credential: row,
        appId: APP_ID,
        providerId: "openai",
        purpose: "runtime_api_key",
      },
    );

    expect(outcome).toEqual({
      credentialId: row.id,
      providerId: "openai",
      purpose: "runtime_api_key",
      reason: "credential_app_mismatch",
      status: "denied",
    });
  });

  test("stores and reads credential secrets through the expected App kind", async () => {
    const database = createSecretDatabase();
    const bindings = createBindings(database);
    const secretId = await storeVendorCredentialSecret(bindings, {
      apiKey: "sk-app",
      credentialId: CREDENTIAL_ID,
      appId: APP_ID,
      providerId: "openai",
      purpose: "credential_create_api_key",
    });
    const row = createCredentialRow({
      credentialId: CREDENTIAL_ID,
      secretId,
      vendorId: "openai",
    });

    const outcome = await readVendorCredentialSecret(bindings, {
      credential: row,
      appId: APP_ID,
      providerId: "openai",
      purpose: "runtime_api_key",
    });

    expect(outcome).toEqual({ apiKey: "sk-app", status: "allowed" });
  });

  test("denies credential reads when the storage kind belongs to another App credential", async () => {
    const database = createSecretDatabase();
    const bindings = createBindings(database);
    const secretId = await storeVendorCredentialSecret(bindings, {
      apiKey: "sk-wrong-app",
      credentialId: OTHER_CREDENTIAL_ID,
      appId: APP_ID,
      providerId: "openai",
      purpose: "credential_create_api_key",
    });
    const row = createCredentialRow({
      credentialId: CREDENTIAL_ID,
      secretId,
      vendorId: "openai",
    });

    const outcome = await readVendorCredentialSecret(bindings, {
      credential: row,
      appId: APP_ID,
      providerId: "openai",
      purpose: "runtime_api_key",
    });

    expect(outcome).toEqual({
      credentialId: CREDENTIAL_ID,
      providerId: "openai",
      purpose: "runtime_api_key",
      reason: "secret_kind_mismatch",
      status: "denied",
    });
  });

  test("deletes credential secrets only through the expected App kind", async () => {
    const database = createSecretDatabase();
    const bindings = createBindings(database);
    const secretId = await storeVendorCredentialSecret(bindings, {
      apiKey: "sk-delete",
      credentialId: CREDENTIAL_ID,
      appId: APP_ID,
      providerId: "openai",
      purpose: "credential_create_api_key",
    });

    const outcome = await deleteVendorCredentialSecret(database, {
      credentialId: CREDENTIAL_ID,
      appId: APP_ID,
      providerId: "openai",
      purpose: "credential_delete",
      secretId,
    });

    expect(outcome).toEqual({ status: "deleted" });
    await expect(readSecretOutcome(database, bindings, secretId)).resolves.toEqual({
      reason: "secret_not_found",
      status: "missing",
    });
  });

  test("denies scoped secret reads when the credential belongs to another App", () => {
    const row = createCredentialRow({
      appId: OTHER_APP_ID,
      vendorId: "openai",
    });

    const denial = getVendorCredentialSecretReadDenial({
      credential: row,
      appId: APP_ID,
      providerId: "openai",
      purpose: "runtime_api_key",
    });

    expect(denial).toBe("credential_app_mismatch");
  });

  test("denies scoped secret reads when the credential belongs to another provider", () => {
    const row = createCredentialRow({ vendorId: "openai" });

    const denial = getVendorCredentialSecretReadDenial({
      credential: row,
      appId: APP_ID,
      providerId: "anthropic",
      purpose: "runtime_api_key",
    });

    expect(denial).toBe("credential_provider_mismatch");
  });

  test("allows scoped secret reads for credentials in the requested App and provider", () => {
    const row = createCredentialRow({ vendorId: "openai" });

    const denial = getVendorCredentialSecretReadDenial({
      credential: row,
      appId: APP_ID,
      providerId: "openai",
      purpose: "runtime_api_key",
    });

    expect(denial).toBeNull();
  });

  test("uses the same App checks for credential display secrets", () => {
    const row = createCredentialRow({
      appId: OTHER_APP_ID,
      vendorId: "openai",
    });

    const denial = getVendorCredentialSecretReadDenial({
      credential: row,
      appId: APP_ID,
      providerId: "openai",
      purpose: "credential_display_api_key",
    });

    expect(denial).toBe("credential_app_mismatch");
  });

  test("collects available vendor IDs from App credentials", () => {
    const rows = [
      createCredentialRow({ vendorId: "openai" }),
      createCredentialRow({ vendorId: "anthropic" }),
    ];

    const availableVendorIds = collectAvailableVendorIds(rows);

    expect(availableVendorIds).toEqual(new Set(["openai", "anthropic"]));
  });

  test("collects available vendor IDs from large App credential lists", () => {
    const rows = Array.from({ length: 120 }, (_, index) =>
      createCredentialRow({
        vendorId: `provider-${index.toString().padStart(3, "0")}`,
      }),
    );

    const availableVendorIds = collectAvailableVendorIds(rows);

    expect(availableVendorIds.has("provider-000")).toBe(true);
    expect(availableVendorIds.has("provider-119")).toBe(true);
  });
});
