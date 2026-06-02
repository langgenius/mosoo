import { describe, expect, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { AccountId, OrganizationId, VendorCredentialId } from "@mosoo/id";
import { VENDOR_OPENAI_COMPATIBLE } from "@mosoo/runtime-catalog";

import {
  resolveVendorApiKey,
  storeVendorCredentialSecret,
} from "../src/modules/vendor-credentials/application/vendor-credential.secret-resolution";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const ACTOR_ID = parsePlatformId<AccountId>("01J00000000000000000000001", "actor ID");
const ORGANIZATION_ID = parsePlatformId<OrganizationId>(
  "01J00000000000000000000002",
  "organization ID",
);
const OPENAI_CREDENTIAL_ID = parsePlatformId<VendorCredentialId>(
  "01J00000000000000000000003",
  "OpenAI credential ID",
);
const CUSTOM_COMPANY_CREDENTIAL_ID = parsePlatformId<VendorCredentialId>(
  "01J00000000000000000000004",
  "custom company credential ID",
);
const CUSTOM_PERSONAL_CREDENTIAL_ID = parsePlatformId<VendorCredentialId>(
  "01J00000000000000000000005",
  "custom personal credential ID",
);

function createCredentialRuntimeDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE organization (
      id text PRIMARY KEY NOT NULL,
      byok_allowed_providers text,
      byok_enabled integer NOT NULL
    );

    CREATE TABLE vendor_credential (
      api_base text,
      api_key_secret_id text NOT NULL,
      created_at integer NOT NULL,
      id text PRIMARY KEY NOT NULL,
      is_default integer NOT NULL DEFAULT 0,
      is_preferred integer NOT NULL DEFAULT 0,
      models text,
      name text NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text,
      updated_at integer NOT NULL,
      vendor_id text NOT NULL
    );

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

    INSERT INTO organization (id, byok_allowed_providers, byok_enabled)
    VALUES ('${ORGANIZATION_ID}', NULL, 1);
  `);

  return database;
}

async function insertVendorCredential(
  database: SqliteD1Database,
  input: {
    apiBase: string | null;
    credentialId: VendorCredentialId;
    isDefault: boolean;
    isPreferred: boolean;
    models: readonly string[] | null;
    name: string;
    ownerAccountId: AccountId | null;
    secretId: string;
    vendorId: string;
  },
): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO vendor_credential (
          api_base,
          api_key_secret_id,
          created_at,
          id,
          is_default,
          is_preferred,
          models,
          name,
          organization_id,
          owner_account_id,
          updated_at,
          vendor_id
        )
        VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `,
    )
    .bind(
      input.apiBase,
      input.secretId,
      input.credentialId,
      input.isDefault ? 1 : 0,
      input.isPreferred ? 1 : 0,
      input.models === null ? null : JSON.stringify(input.models),
      input.name,
      ORGANIZATION_ID,
      input.ownerAccountId,
      input.vendorId,
    )
    .run();
}

describe("vendor credential runtime selection", () => {
  test("resolves the matching custom model credential for runtime access", async () => {
    const database = createCredentialRuntimeDatabase();
    const bindings = {
      DB: database,
      VAULT_ROOT_SECRET: "test-vault-root-secret",
    } as ApiBindings;
    const openAiSecretId = await storeVendorCredentialSecret(bindings, {
      actorAccountId: ACTOR_ID,
      apiKey: "openai-key",
      credentialId: OPENAI_CREDENTIAL_ID,
      organizationId: ORGANIZATION_ID,
      ownerAccountId: null,
      providerId: "openai",
      purpose: "credential_create_api_key",
      scope: "company",
    });
    const customCompanySecretId = await storeVendorCredentialSecret(bindings, {
      actorAccountId: ACTOR_ID,
      apiKey: "custom-company-key",
      credentialId: CUSTOM_COMPANY_CREDENTIAL_ID,
      organizationId: ORGANIZATION_ID,
      ownerAccountId: null,
      providerId: VENDOR_OPENAI_COMPATIBLE.vendorId,
      purpose: "credential_create_api_key",
      scope: "company",
    });
    const customPersonalSecretId = await storeVendorCredentialSecret(bindings, {
      actorAccountId: ACTOR_ID,
      apiKey: "custom-personal-key",
      credentialId: CUSTOM_PERSONAL_CREDENTIAL_ID,
      organizationId: ORGANIZATION_ID,
      ownerAccountId: ACTOR_ID,
      providerId: VENDOR_OPENAI_COMPATIBLE.vendorId,
      purpose: "credential_create_api_key",
      scope: "personal",
    });

    await insertVendorCredential(database, {
      apiBase: null,
      credentialId: OPENAI_CREDENTIAL_ID,
      isDefault: true,
      isPreferred: false,
      models: null,
      name: "OpenAI company",
      ownerAccountId: null,
      secretId: openAiSecretId,
      vendorId: "openai",
    });
    await insertVendorCredential(database, {
      apiBase: "https://company.example.com/v1",
      credentialId: CUSTOM_COMPANY_CREDENTIAL_ID,
      isDefault: true,
      isPreferred: false,
      models: ["qwen-coder"],
      name: "Custom company",
      ownerAccountId: null,
      secretId: customCompanySecretId,
      vendorId: VENDOR_OPENAI_COMPATIBLE.vendorId,
    });
    await insertVendorCredential(database, {
      apiBase: "https://personal.example.com/v1",
      credentialId: CUSTOM_PERSONAL_CREDENTIAL_ID,
      isDefault: false,
      isPreferred: true,
      models: ["qwen-coder"],
      name: "Custom personal",
      ownerAccountId: ACTOR_ID,
      secretId: customPersonalSecretId,
      vendorId: VENDOR_OPENAI_COMPATIBLE.vendorId,
    });

    const credential = await resolveVendorApiKey({
      actorAccountId: ACTOR_ID,
      bindings,
      options: { modelId: "qwen-coder" },
      organizationId: ORGANIZATION_ID,
      vendorId: VENDOR_OPENAI_COMPATIBLE.vendorId,
    });

    expect(credential).toEqual({
      apiBase: "https://personal.example.com/v1",
      apiKey: "custom-personal-key",
      credentialId: CUSTOM_PERSONAL_CREDENTIAL_ID,
      scope: "personal",
    });
  });
});
