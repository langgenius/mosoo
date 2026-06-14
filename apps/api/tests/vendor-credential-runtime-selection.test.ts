import { describe, expect, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { AccountId, OrganizationId, AppId, VendorCredentialId } from "@mosoo/id";
import { VENDOR_OPENAI, VENDOR_OPENAI_COMPATIBLE } from "@mosoo/runtime-catalog";

import { collectRuntimeCapabilityIssues } from "../src/modules/agents/application/agent-runtime-capability-resolution.service";
import {
  resolveVendorApiKey,
  storeVendorCredentialSecret,
} from "../src/modules/vendor-credentials/application/vendor-credential.secret-resolution";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const ORGANIZATION_ID = parsePlatformId<OrganizationId>(
  "01J00000000000000000000002",
  "organization ID",
);
const APP_ID = parsePlatformId<AppId>("01J00000000000000000000009", "app ID");
const APP_OWNER_ID = parsePlatformId<AccountId>(
  "01J00000000000000000000001",
  "app owner account ID",
);
const OTHER_ACCOUNT_ID = parsePlatformId<AccountId>(
  "01J00000000000000000000008",
  "other account ID",
);
const OPENAI_CREDENTIAL_ID = parsePlatformId<VendorCredentialId>(
  "01J00000000000000000000003",
  "OpenAI credential ID",
);
const CUSTOM_PRIMARY_CREDENTIAL_ID = parsePlatformId<VendorCredentialId>(
  "01J00000000000000000000004",
  "primary custom credential ID",
);
const CUSTOM_SECONDARY_CREDENTIAL_ID = parsePlatformId<VendorCredentialId>(
  "01J00000000000000000000005",
  "secondary custom credential ID",
);

function createCredentialRuntimeDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE organization (
      id text PRIMARY KEY NOT NULL
    );

    CREATE TABLE app (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      name text NOT NULL,
      slug text NOT NULL,
      default_environment_id text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE vendor_credential (
      api_base text,
      api_key_secret_id text NOT NULL,
      created_at integer NOT NULL,
      id text PRIMARY KEY NOT NULL,
      models text,
      name text NOT NULL,
      organization_id text NOT NULL,
      app_id text NOT NULL,
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
  `);

  database.prepare("INSERT INTO organization (id) VALUES (?)").bind(ORGANIZATION_ID).run();

  database
    .prepare(
      `
        INSERT INTO app (
          id,
          organization_id,
          owner_account_id,
          name,
          slug,
          default_environment_id,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, 'Default App', 'default', NULL, 1, 1)
      `,
    )
    .bind(APP_ID, ORGANIZATION_ID, APP_OWNER_ID)
    .run();

  return database;
}

async function insertVendorCredential(
  database: SqliteD1Database,
  input: {
    apiBase: string | null;
    credentialId: VendorCredentialId;
    models: readonly string[] | null;
    name: string;
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
          models,
          name,
          organization_id,
          app_id,
          updated_at,
          vendor_id
        )
        VALUES (?, ?, 1, ?, ?, ?, ?, ?, 1, ?)
      `,
    )
    .bind(
      input.apiBase,
      input.secretId,
      input.credentialId,
      input.models === null ? null : JSON.stringify(input.models),
      input.name,
      ORGANIZATION_ID,
      APP_ID,
      input.vendorId,
    )
    .run();
}

describe("vendor credential runtime selection", () => {
  test("resolves the first App custom credential that declares the requested model", async () => {
    const database = createCredentialRuntimeDatabase();
    const bindings = {
      DB: database,
      VAULT_ROOT_SECRET: "test-vault-root-secret",
    } as ApiBindings;
    const openAiSecretId = await storeVendorCredentialSecret(bindings, {
      apiKey: "openai-key",
      credentialId: OPENAI_CREDENTIAL_ID,
      appId: APP_ID,
      providerId: "openai",
      purpose: "credential_create_api_key",
    });
    const primaryCustomSecretId = await storeVendorCredentialSecret(bindings, {
      apiKey: "custom-primary-key",
      credentialId: CUSTOM_PRIMARY_CREDENTIAL_ID,
      appId: APP_ID,
      providerId: VENDOR_OPENAI_COMPATIBLE.vendorId,
      purpose: "credential_create_api_key",
    });
    const secondaryCustomSecretId = await storeVendorCredentialSecret(bindings, {
      apiKey: "custom-secondary-key",
      credentialId: CUSTOM_SECONDARY_CREDENTIAL_ID,
      appId: APP_ID,
      providerId: VENDOR_OPENAI_COMPATIBLE.vendorId,
      purpose: "credential_create_api_key",
    });

    await insertVendorCredential(database, {
      apiBase: null,
      credentialId: OPENAI_CREDENTIAL_ID,
      models: null,
      name: "OpenAI",
      secretId: openAiSecretId,
      vendorId: "openai",
    });
    await insertVendorCredential(database, {
      apiBase: "https://secondary.example.com/v1",
      credentialId: CUSTOM_SECONDARY_CREDENTIAL_ID,
      models: ["qwen-coder"],
      name: "B Custom",
      secretId: secondaryCustomSecretId,
      vendorId: VENDOR_OPENAI_COMPATIBLE.vendorId,
    });
    await insertVendorCredential(database, {
      apiBase: "https://primary.example.com/v1",
      credentialId: CUSTOM_PRIMARY_CREDENTIAL_ID,
      models: ["qwen-coder"],
      name: "A Custom",
      secretId: primaryCustomSecretId,
      vendorId: VENDOR_OPENAI_COMPATIBLE.vendorId,
    });

    const credential = await resolveVendorApiKey({
      bindings,
      executionOwnerUserId: APP_OWNER_ID,
      options: { modelId: "qwen-coder" },
      appId: APP_ID,
      vendorId: VENDOR_OPENAI_COMPATIBLE.vendorId,
    });

    expect(credential).toEqual({
      apiBase: "https://primary.example.com/v1",
      apiKey: "custom-primary-key",
      credentialId: CUSTOM_PRIMARY_CREDENTIAL_ID,
    });

    await expect(
      resolveVendorApiKey({
        bindings,
        executionOwnerUserId: OTHER_ACCOUNT_ID,
        options: { modelId: "qwen-coder" },
        appId: APP_ID,
        vendorId: VENDOR_OPENAI_COMPATIBLE.vendorId,
      }),
    ).resolves.toBeNull();
  });

  test("does not resolve App provider keys for a non-owner execution actor", async () => {
    const database = createCredentialRuntimeDatabase();
    const bindings = {
      DB: database,
      VAULT_ROOT_SECRET: "test-vault-root-secret",
    } as ApiBindings;
    const openAiSecretId = await storeVendorCredentialSecret(bindings, {
      apiKey: "openai-key",
      credentialId: OPENAI_CREDENTIAL_ID,
      appId: APP_ID,
      providerId: VENDOR_OPENAI.vendorId,
      purpose: "credential_create_api_key",
    });

    await insertVendorCredential(database, {
      apiBase: null,
      credentialId: OPENAI_CREDENTIAL_ID,
      models: null,
      name: "OpenAI",
      secretId: openAiSecretId,
      vendorId: VENDOR_OPENAI.vendorId,
    });

    await expect(
      resolveVendorApiKey({
        bindings,
        executionOwnerUserId: OTHER_ACCOUNT_ID,
        options: { modelId: "gpt-4o-mini" },
        appId: APP_ID,
        vendorId: VENDOR_OPENAI.vendorId,
      }),
    ).resolves.toBeNull();

    await expect(
      resolveVendorApiKey({
        bindings,
        executionOwnerUserId: APP_OWNER_ID,
        options: { modelId: "gpt-4o-mini" },
        appId: APP_ID,
        vendorId: VENDOR_OPENAI.vendorId,
      }),
    ).resolves.toEqual({
      apiBase: null,
      apiKey: "openai-key",
      credentialId: OPENAI_CREDENTIAL_ID,
    });
  });

  test("reports provider credentials missing when readiness actor does not own the App", async () => {
    const database = createCredentialRuntimeDatabase();

    await insertVendorCredential(database, {
      apiBase: null,
      credentialId: OPENAI_CREDENTIAL_ID,
      models: null,
      name: "OpenAI",
      secretId: "secret-openai",
      vendorId: VENDOR_OPENAI.vendorId,
    });

    const issues = await collectRuntimeCapabilityIssues({
      actorAccountId: OTHER_ACCOUNT_ID,
      codePrefix: "agent.readiness",
      database,
      organizationId: ORGANIZATION_ID,
      appId: APP_ID,
      selection: {
        model: "gpt-5.4",
        provider: VENDOR_OPENAI.vendorId,
        runtimeId: "openai-runtime",
      },
    });

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: "agent.readiness.provider_credential.missing",
        targetLabel: VENDOR_OPENAI.vendorId,
      }),
    );
  });
});
