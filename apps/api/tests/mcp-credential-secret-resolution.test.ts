import { describe, expect, test } from "bun:test";

import type { AccountId, AgentId, CredentialId, McpServerId, OrganizationId } from "@mosoo/id";

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
const OTHER_ORGANIZATION_ID = "01J00000000000000000000002" as OrganizationId;
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
    credentialScope: "user",
    description: null,
    enabled: 1,
    iconUrl: null,
    id: SERVER_ID,
    name: "MCP",
    oauthMetadataJson: null,
    organizationId: ORGANIZATION_ID,
    ownerId: OWNER_ID,
    ownerName: "Owner",
    source: "organization_shared",
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
    refreshSecretId: MISSING_SECRET_ID,
    scope: "user",
    scopeValuesJson: "[]",
    secretId: MISSING_SECRET_ID,
    serverId: SERVER_ID,
    status: "active",
    subjectLabel: null,
    updatedAt: 1,
    userId: OWNER_ID,
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
      scope: "user",
      secretKind: "refresh_token",
      server,
      userId: OWNER_ID,
      value: "refresh-token",
    });
    const credential = createCredential({ refreshSecretId });
    const outcome = await readMcpCredentialSecret(bindings, {
      credential,
      organizationId: ORGANIZATION_ID,
      purpose: "runtime_refresh_token",
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
      organizationId?: OrganizationId;
      purpose: McpCredentialSecretReadPurpose;
      reason: string;
      server?: Partial<ServerRow>;
    }[] = [
      {
        organizationId: OTHER_ORGANIZATION_ID,
        purpose: "runtime_access_token",
        reason: "server_organization_mismatch",
      },
      {
        credential: { serverId: OTHER_SERVER_ID },
        purpose: "runtime_access_token",
        reason: "credential_server_mismatch",
      },
      {
        credential: { agentId: AGENT_ID, scope: "user", userId: null },
        purpose: "runtime_access_token",
        reason: "credential_scope_owner_mismatch",
      },
      {
        credential: { scope: "organization_shared", userId: null },
        purpose: "runtime_access_token",
        reason: "credential_scope_mismatch",
        server: { credentialScope: "user" },
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
        organizationId: testCase.organizationId ?? ORGANIZATION_ID,
        purpose: testCase.purpose,
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
      scope: "user",
      secretKind: "refresh_token",
      server: createServer(),
      userId: OWNER_ID,
      value: "refresh-token",
    });

    const outcome = await readMcpCredentialSecret(bindings, {
      credential: createCredential({ refreshSecretId }),
      organizationId: ORGANIZATION_ID,
      purpose: "runtime_refresh_token",
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
      scope: "user",
      secretKind: "access_token",
      server,
      userId: OWNER_ID,
      value: "access-token",
    });

    const outcome = await deleteMcpCredentialSecret(database, {
      agentId: null,
      credentialId: CREDENTIAL_ID,
      purpose: "credential_revoke",
      scope: "user",
      secretId,
      secretKind: "access_token",
      server,
      userId: OWNER_ID,
    });

    expect(outcome).toEqual({ status: "deleted" });
    await expect(readSecretOutcome(database, bindings, secretId ?? "")).resolves.toEqual({
      reason: "secret_not_found",
      status: "missing",
    });
  });
});
