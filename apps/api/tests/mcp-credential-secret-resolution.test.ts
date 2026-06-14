import { describe, expect, test } from "bun:test";

import type {
  AccountId,
  AgentId,
  CredentialId,
  McpServerId,
  OrganizationId,
  AppId,
} from "@mosoo/id";

import {
  deleteMcpCredentialSecret,
  readMcpCredentialSecret,
  replaceMcpCredentialSecret,
} from "../src/modules/mcp/application/mcp-credential-secret-resolution";
import type { McpCredentialSecretReadPurpose } from "../src/modules/mcp/application/mcp-credential-secret-resolution";
import { readSecretOutcome } from "../src/modules/mcp/application/mcp-secret-store";
import type { CredentialRow, ServerRow } from "../src/modules/mcp/application/mcp-types";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const ORGANIZATION_ID = "01J00000000000000000000001" as OrganizationId;
const APP_ID = "01J00000000000000000000002" as AppId;
const OTHER_APP_ID = "01J0000000000000000000000A" as AppId;
const OWNER_ID = "01J00000000000000000000003" as AccountId;
const AGENT_ID = "01J00000000000000000000004" as AgentId;
const SERVER_ID = "01J00000000000000000000005" as McpServerId;
const OTHER_SERVER_ID = "01J00000000000000000000006" as McpServerId;
const CREDENTIAL_ID = "01J00000000000000000000007" as CredentialId;
const MISSING_SECRET_ID = "01J00000000000000000000008";
const OTHER_CREDENTIAL_ID = "01J00000000000000000000009" as CredentialId;

function createVaultDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE vault_secret (
      id text PRIMARY KEY NOT NULL,
      kind text NOT NULL,
      algorithm text DEFAULT 'AES-GCM' NOT NULL,
      ciphertext text NOT NULL,
      ciphertext_iv text NOT NULL,
      wrapped_dek text NOT NULL,
      wrapped_dek_iv text NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
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

function createServer(input: Partial<ServerRow> = {}): ServerRow {
  return {
    authType: "oauth",
    byoClientId: null,
    byoClientSecretSecretId: null,
    createdAt: 1,
    credentialScope: "app",
    description: null,
    enabled: 1,
    iconUrl: null,
    id: SERVER_ID,
    name: "MCP",
    oauthMetadataJson: null,
    organizationId: ORGANIZATION_ID,
    ownerId: OWNER_ID,
    ownerName: "Owner",
    appId: APP_ID,
    source: "app",
    updatedAt: 1,
    url: "https://mcp.example.com",
    ...input,
  };
}

function createCredential(input: Partial<CredentialRow> = {}): CredentialRow {
  return {
    agentId: null,
    authType: "oauth",
    createdAt: 1,
    expiresAt: null,
    id: CREDENTIAL_ID,
    lastRefreshedAt: null,
    oauthClientId: "client",
    oauthClientSecretSecretId: null,
    appId: APP_ID,
    refreshSecretId: MISSING_SECRET_ID,
    scope: "app",
    scopeValuesJson: "[]",
    secretId: MISSING_SECRET_ID,
    serverId: SERVER_ID,
    status: "active",
    subjectLabel: null,
    updatedAt: 1,
    userId: null,
    ...input,
  };
}

describe("MCP credential secret resolution", () => {
  test("reads a secret only through the owning credential row and purpose", async () => {
    const database = createVaultDatabase();
    const bindings = createBindings(database);
    const server = createServer();
    const refreshSecretId = await replaceMcpCredentialSecret(bindings, {
      agentId: null,
      credentialId: CREDENTIAL_ID,
      currentSecretId: null,
      purpose: "credential_refresh_token",
      scope: "app",
      secretKind: "refresh_token",
      server,
      userId: null,
      value: "refresh-token",
    });
    const credential = createCredential({ refreshSecretId });
    const outcome = await readMcpCredentialSecret(bindings, {
      credential,
      purpose: "runtime_refresh_token",
      appId: APP_ID,
      server,
    });

    expect(outcome).toEqual({
      status: "allowed",
      value: "refresh-token",
    });
  });

  test("denies secret reads when row ownership or purpose does not match", async () => {
    const database = createVaultDatabase();
    const bindings = createBindings(database);

    const cases: {
      credential?: Partial<CredentialRow>;
      purpose: McpCredentialSecretReadPurpose;
      appId?: AppId;
      reason: string;
      server?: Partial<ServerRow>;
    }[] = [
      {
        purpose: "runtime_access_token",
        appId: OTHER_APP_ID,
        reason: "server_app_mismatch",
      },
      {
        credential: { serverId: OTHER_SERVER_ID },
        purpose: "runtime_access_token",
        reason: "credential_server_mismatch",
      },
      {
        credential: { agentId: AGENT_ID, scope: "app", userId: null },
        purpose: "runtime_access_token",
        reason: "credential_scope_owner_mismatch",
      },
      {
        credential: { scope: "agent", userId: null },
        purpose: "runtime_access_token",
        reason: "credential_scope_owner_mismatch",
      },
      {
        credential: { authType: "bearer" },
        purpose: "runtime_refresh_token",
        reason: "credential_auth_type_mismatch",
      },
      {
        credential: { refreshSecretId: null },
        purpose: "runtime_refresh_token",
        reason: "credential_secret_missing",
      },
      {
        purpose: "runtime_access_token",
        reason: "secret_not_found",
      },
    ];

    for (const testCase of cases) {
      const outcome = await readMcpCredentialSecret(bindings, {
        credential: createCredential(testCase.credential),
        purpose: testCase.purpose,
        appId: testCase.appId ?? APP_ID,
        server: createServer(testCase.server),
      });

      expect(outcome).toMatchObject({
        reason: testCase.reason,
        status: "denied",
      });
    }
  });

  test("denies secret reads when storage kind does not match the credential owner", async () => {
    const database = createVaultDatabase();
    const bindings = createBindings(database);
    const refreshSecretId = await replaceMcpCredentialSecret(bindings, {
      agentId: null,
      credentialId: OTHER_CREDENTIAL_ID,
      currentSecretId: null,
      purpose: "credential_refresh_token",
      scope: "app",
      secretKind: "refresh_token",
      server: createServer(),
      userId: null,
      value: "refresh-token",
    });

    const outcome = await readMcpCredentialSecret(bindings, {
      credential: createCredential({ refreshSecretId }),
      purpose: "runtime_refresh_token",
      appId: APP_ID,
      server: createServer(),
    });

    expect(outcome).toMatchObject({
      reason: "secret_kind_mismatch",
      status: "denied",
    });
  });

  test("deletes credential secrets only through the expected owner kind", async () => {
    const database = createVaultDatabase();
    const bindings = createBindings(database);
    const server = createServer();
    const secretId = await replaceMcpCredentialSecret(bindings, {
      agentId: null,
      credentialId: CREDENTIAL_ID,
      currentSecretId: null,
      purpose: "credential_access_token",
      scope: "app",
      secretKind: "access_token",
      server,
      userId: null,
      value: "access-token",
    });

    const outcome = await deleteMcpCredentialSecret(database, {
      agentId: null,
      credentialId: CREDENTIAL_ID,
      purpose: "credential_revoke",
      scope: "app",
      secretId,
      secretKind: "access_token",
      server,
      userId: null,
    });

    expect(outcome).toEqual({ status: "deleted" });
    await expect(readSecretOutcome(database, bindings, secretId ?? "")).resolves.toEqual({
      reason: "secret_not_found",
      status: "missing",
    });
  });
});
