import { describe, expect, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { AccountId, OrganizationId, PlatformId, VendorCredentialId } from "@mosoo/id";

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

const ACTOR_ID = parsePlatformId<AccountId>("01J00000000000000000000001", "actor ID");
const OTHER_ACTOR_ID = parsePlatformId<AccountId>("01J00000000000000000000002", "other actor ID");
const ORGANIZATION_ID = parsePlatformId<OrganizationId>(
  "01J00000000000000000000006",
  "organization ID",
);
const CREDENTIAL_ID = parsePlatformId<VendorCredentialId>(
  "01J00000000000000000000007",
  "credential ID",
);
const OTHER_CREDENTIAL_ID = parsePlatformId<VendorCredentialId>(
  "01J00000000000000000000008",
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
  isPreferred?: number;
  onReadVendorId?: () => void;
  ownerUserId?: string | null;
  secretId?: PlatformId;
  vendorId: string;
}): VendorCredentialRow {
  const ownerUserId = input.ownerUserId ?? null;
  const row = {
    apiBase: null,
    apiKeySecretId: input.secretId ?? `${input.vendorId}-secret`,
    id:
      input.credentialId ??
      `${input.vendorId}-${ownerUserId ?? "company"}-${input.isPreferred ?? 0}`,
    isDefault: ownerUserId === null ? 1 : 0,
    isPreferred: input.isPreferred ?? 0,
    modelsJson: null,
    name: `${input.vendorId} credential`,
    organizationId: ORGANIZATION_ID,
    ownerUserId,
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
  test("returns typed denial outcomes before reading storage", async () => {
    const row = createCredentialRow({
      ownerUserId: "account-2",
      vendorId: "openai",
    });

    const outcome = await readVendorCredentialSecret(
      {
        DB: {} as D1Database,
        VAULT_ROOT_SECRET: "unused",
      },
      {
        actorAccountId: "account-1",
        credential: row,
        organizationId: "01J00000000000000000000006",
        providerId: "openai",
        purpose: "runtime_api_key",
      },
    );

    expect(outcome).toEqual({
      credentialId: row.id,
      providerId: "openai",
      purpose: "runtime_api_key",
      reason: "credential_owner_mismatch",
      status: "denied",
    });
  });

  test("stores and reads credential secrets through the expected owner kind", async () => {
    const database = createSecretDatabase();
    const bindings = createBindings(database);
    const secretId = await storeVendorCredentialSecret(bindings, {
      actorAccountId: ACTOR_ID,
      apiKey: "sk-owner",
      credentialId: CREDENTIAL_ID,
      organizationId: ORGANIZATION_ID,
      ownerAccountId: null,
      providerId: "openai",
      purpose: "credential_create_api_key",
      scope: "company",
    });
    const row = createCredentialRow({
      credentialId: CREDENTIAL_ID,
      secretId,
      vendorId: "openai",
    });

    const outcome = await readVendorCredentialSecret(bindings, {
      actorAccountId: ACTOR_ID,
      credential: row,
      organizationId: ORGANIZATION_ID,
      providerId: "openai",
      purpose: "runtime_api_key",
    });

    expect(outcome).toEqual({ apiKey: "sk-owner", status: "allowed" });
  });

  test("denies credential reads when the storage kind belongs to another owner", async () => {
    const database = createSecretDatabase();
    const bindings = createBindings(database);
    const secretId = await storeVendorCredentialSecret(bindings, {
      actorAccountId: ACTOR_ID,
      apiKey: "sk-wrong-owner",
      credentialId: OTHER_CREDENTIAL_ID,
      organizationId: ORGANIZATION_ID,
      ownerAccountId: null,
      providerId: "openai",
      purpose: "credential_create_api_key",
      scope: "company",
    });
    const row = createCredentialRow({
      credentialId: CREDENTIAL_ID,
      secretId,
      vendorId: "openai",
    });

    const outcome = await readVendorCredentialSecret(bindings, {
      actorAccountId: ACTOR_ID,
      credential: row,
      organizationId: ORGANIZATION_ID,
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

  test("deletes credential secrets only through the expected owner kind", async () => {
    const database = createSecretDatabase();
    const bindings = createBindings(database);
    const secretId = await storeVendorCredentialSecret(bindings, {
      actorAccountId: ACTOR_ID,
      apiKey: "sk-delete",
      credentialId: CREDENTIAL_ID,
      organizationId: ORGANIZATION_ID,
      ownerAccountId: null,
      providerId: "openai",
      purpose: "credential_create_api_key",
      scope: "company",
    });

    const outcome = await deleteVendorCredentialSecret(database, {
      actorAccountId: ACTOR_ID,
      credentialId: CREDENTIAL_ID,
      organizationId: ORGANIZATION_ID,
      ownerAccountId: null,
      providerId: "openai",
      purpose: "credential_delete",
      scope: "company",
      secretId,
    });

    expect(outcome).toEqual({ status: "deleted" });
    await expect(readSecretOutcome(database, bindings, secretId)).resolves.toEqual({
      reason: "secret_not_found",
      status: "missing",
    });
  });

  test("denies personal credential secret writes for another actor", async () => {
    const database = createSecretDatabase();
    const bindings = createBindings(database);

    await expect(
      storeVendorCredentialSecret(bindings, {
        actorAccountId: OTHER_ACTOR_ID,
        apiKey: "sk-personal",
        credentialId: CREDENTIAL_ID,
        organizationId: ORGANIZATION_ID,
        ownerAccountId: ACTOR_ID,
        providerId: "openai",
        purpose: "credential_create_api_key",
        scope: "personal",
      }),
    ).rejects.toThrow();
  });

  test("allows scoped secret reads for company credentials in the requested organization and provider", () => {
    const row = createCredentialRow({ vendorId: "openai" });

    const denial = getVendorCredentialSecretReadDenial({
      actorAccountId: "account-1",
      credential: row,
      organizationId: "01J00000000000000000000006",
      providerId: "openai",
      purpose: "runtime_api_key",
    });

    expect(denial).toBeNull();
  });

  test("denies scoped secret reads when the credential belongs to another organization", () => {
    const row = createCredentialRow({ vendorId: "openai" });

    const denial = getVendorCredentialSecretReadDenial({
      actorAccountId: "account-1",
      credential: row,
      organizationId: "org-2",
      providerId: "openai",
      purpose: "runtime_api_key",
    });

    expect(denial).toBe("credential_organization_mismatch");
  });

  test("denies scoped secret reads when the credential belongs to another provider", () => {
    const row = createCredentialRow({ vendorId: "openai" });

    const denial = getVendorCredentialSecretReadDenial({
      actorAccountId: "account-1",
      credential: row,
      organizationId: "01J00000000000000000000006",
      providerId: "anthropic",
      purpose: "runtime_api_key",
    });

    expect(denial).toBe("credential_provider_mismatch");
  });

  test("denies scoped secret reads when the actor does not own the personal credential", () => {
    const row = createCredentialRow({
      ownerUserId: "account-2",
      vendorId: "openai",
    });

    const denial = getVendorCredentialSecretReadDenial({
      actorAccountId: "account-1",
      credential: row,
      organizationId: "01J00000000000000000000006",
      providerId: "openai",
      purpose: "runtime_api_key",
    });

    expect(denial).toBe("credential_owner_mismatch");
  });

  test("uses the same owner checks for credential display secrets", () => {
    const row = createCredentialRow({
      ownerUserId: "account-2",
      vendorId: "openai",
    });

    const denial = getVendorCredentialSecretReadDenial({
      actorAccountId: "account-1",
      credential: row,
      organizationId: "01J00000000000000000000006",
      providerId: "openai",
      purpose: "credential_display_api_key",
    });

    expect(denial).toBe("credential_owner_mismatch");
  });

  test("collects available company credential vendors", () => {
    const rows = [
      createCredentialRow({ vendorId: "company-openai" }),
      createCredentialRow({ vendorId: "company-anthropic" }),
    ];

    const availableVendorIds = collectAvailableVendorIds("account-1", rows);

    expect(availableVendorIds).toEqual(new Set(["company-openai", "company-anthropic"]));
  });

  test("collects only the actor's preferred personal credential", () => {
    const rows = [
      createCredentialRow({
        isPreferred: 1,
        ownerUserId: "account-1",
        vendorId: "preferred-personal",
      }),
      createCredentialRow({
        isPreferred: 0,
        ownerUserId: "account-1",
        vendorId: "non-preferred-personal",
      }),
      createCredentialRow({
        isPreferred: 1,
        ownerUserId: "account-2",
        vendorId: "other-actor-personal",
      }),
    ];

    const availableVendorIds = collectAvailableVendorIds("account-1", rows);

    expect(availableVendorIds).toEqual(new Set(["preferred-personal"]));
  });

  test("collects available vendor IDs from large credential lists", () => {
    const rows = [
      ...Array.from({ length: 120 }, (_, index) =>
        createCredentialRow({
          vendorId: `company-${index.toString().padStart(3, "0")}`,
        }),
      ),
      createCredentialRow({
        isPreferred: 1,
        ownerUserId: "account-1",
        vendorId: "preferred-personal",
      }),
      createCredentialRow({
        isPreferred: 0,
        ownerUserId: "account-1",
        vendorId: "non-preferred-personal",
      }),
    ];

    const availableVendorIds = collectAvailableVendorIds("account-1", rows);

    expect(availableVendorIds.has("company-000")).toBe(true);
    expect(availableVendorIds.has("company-119")).toBe(true);
    expect(availableVendorIds.has("preferred-personal")).toBe(true);
    expect(availableVendorIds.has("non-preferred-personal")).toBe(false);
  });
});
