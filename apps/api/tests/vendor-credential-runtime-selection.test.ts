import { describe, expect, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { AccountId, OrganizationId, ProjectId, VendorCredentialId } from "@mosoo/id";
import { VENDOR_OPENAI_COMPATIBLE } from "@mosoo/runtime-catalog";

import { resolveVendorCredentialRef } from "../src/modules/vendor-credentials/application/vendor-credential.secret-resolution";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const ORGANIZATION_ID = parsePlatformId<OrganizationId>(
  "01J00000000000000000000002",
  "organization ID",
);
const PROJECT_ID = parsePlatformId<ProjectId>("01J00000000000000000000009", "project ID");
const PROJECT_OWNER_ID = parsePlatformId<AccountId>(
  "01J00000000000000000000001",
  "project owner account ID",
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

    CREATE TABLE project (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      name text NOT NULL,
      default_environment_id text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE vendor_credential (
      api_base text,
      api_key_secret_id text NOT NULL,
      created_at integer NOT NULL,
      id text PRIMARY KEY NOT NULL,
      is_default integer DEFAULT false NOT NULL,
      model_protocol text,
      models text,
      name text NOT NULL,
      project_id text NOT NULL,
      updated_at integer NOT NULL,
      vendor_id text NOT NULL
    );
  `);

  database.prepare("INSERT INTO organization (id) VALUES (?)").bind(ORGANIZATION_ID).run();

  database
    .prepare(
      `
        INSERT INTO project (
          id,
          organization_id,
          owner_account_id,
          name,
          default_environment_id,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, 'Default Project', NULL, 1, 1)
      `,
    )
    .bind(PROJECT_ID, ORGANIZATION_ID, PROJECT_OWNER_ID)
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
          project_id,
          updated_at,
          vendor_id
        )
        VALUES (?, ?, 1, ?, ?, ?, ?, 1, ?)
      `,
    )
    .bind(
      input.apiBase,
      input.secretId,
      input.credentialId,
      input.models === null ? null : JSON.stringify(input.models),
      input.name,
      PROJECT_ID,
      input.vendorId,
    )
    .run();
}

describe("vendor credential runtime selection", () => {
  test("resolves the first Project custom credential that declares the requested model", async () => {
    const database = createCredentialRuntimeDatabase();

    await insertVendorCredential(database, {
      apiBase: null,
      credentialId: OPENAI_CREDENTIAL_ID,
      models: null,
      name: "OpenAI",
      secretId: "secret-openai",
      vendorId: "openai",
    });
    await insertVendorCredential(database, {
      apiBase: "https://secondary.deepseek.example/v1",
      credentialId: CUSTOM_SECONDARY_CREDENTIAL_ID,
      models: ["deepseek-v4-flash"],
      name: "B Custom",
      secretId: "secret-secondary",
      vendorId: VENDOR_OPENAI_COMPATIBLE.vendorId,
    });
    await insertVendorCredential(database, {
      apiBase: "https://api.deepseek.com",
      credentialId: CUSTOM_PRIMARY_CREDENTIAL_ID,
      models: ["deepseek-v4-flash"],
      name: "A Custom",
      secretId: "secret-primary",
      vendorId: VENDOR_OPENAI_COMPATIBLE.vendorId,
    });

    const credential = await resolveVendorCredentialRef({
      bindings: { DB: database } as ApiBindings,
      options: { modelId: "deepseek-v4-flash" },
      projectId: PROJECT_ID,
      vendorId: VENDOR_OPENAI_COMPATIBLE.vendorId,
    });

    expect(credential).toEqual({
      apiBase: "https://api.deepseek.com",
      credentialId: CUSTOM_PRIMARY_CREDENTIAL_ID,
      modelProtocol: null,
      models: ["deepseek-v4-flash"],
      projectId: PROJECT_ID,
      vendorId: VENDOR_OPENAI_COMPATIBLE.vendorId,
    });
  });
});
