import { describe, expect, test } from "bun:test";

import type { AccountId, McpOAuthFlowId, McpServerId, OrganizationId, AppId } from "@mosoo/id";

import {
  deleteMcpOAuthFlowClientSecret,
  readMcpOAuthFlowClientSecret,
  readMcpOAuthServerClientSecret,
  storeMcpOAuthFlowClientSecret,
  storeMcpOAuthServerClientSecret,
} from "../src/modules/mcp/application/mcp-oauth-secret-resolution";
import type { McpOAuthSecretReadDenialReason } from "../src/modules/mcp/application/mcp-oauth-secret-resolution";
import type { OAuthFlowRow, ServerRow } from "../src/modules/mcp/application/mcp-types";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const ORGANIZATION_ID = "01J00000000000000000000001" as OrganizationId;
const APP_ID = "01J00000000000000000000002" as AppId;
const OTHER_APP_ID = "01J00000000000000000000009" as AppId;
const OWNER_ID = "01J00000000000000000000003" as AccountId;
const OTHER_ACCOUNT_ID = "01J00000000000000000000004" as AccountId;
const SERVER_ID = "01J00000000000000000000005" as McpServerId;
const OTHER_SERVER_ID = "01J00000000000000000000006" as McpServerId;
const FLOW_ID = "01J00000000000000000000007" as McpOAuthFlowId;
const MISSING_SECRET_ID = "01J00000000000000000000008";

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

function createBindings(database: D1Database): Pick<ApiBindings, "DB" | "VAULT_ROOT_SECRET"> {
  return {
    DB: database,
    VAULT_ROOT_SECRET: "test-root-secret",
  };
}

function createActor(accountId: AccountId = OWNER_ID) {
  return {
    accountId,
    type: "user" as const,
  };
}

function createServer(input: Partial<ServerRow> = {}): ServerRow {
  return {
    authType: "oauth",
    byoClientId: "client",
    byoClientSecretSecretId: MISSING_SECRET_ID,
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

function createFlow(input: Partial<OAuthFlowRow> = {}): OAuthFlowRow {
  return {
    codeVerifier: "verifier",
    createdAt: 1,
    errorMessage: null,
    expiresAt: 2,
    id: FLOW_ID,
    initiatorUserId: OWNER_ID,
    oauthClientId: "client",
    oauthClientSecretSecretId: MISSING_SECRET_ID,
    organizationId: ORGANIZATION_ID,
    appId: APP_ID,
    returnUrl: null,
    scopeValuesJson: "[]",
    serverId: SERVER_ID,
    status: "pending",
    subjectLabel: null,
    tokenEndpoint: "https://mcp.example.com/oauth/token",
    ...input,
  };
}

describe("MCP OAuth secret resolution", () => {
  test("reads server and flow client secrets through their owning rows", async () => {
    const database = createVaultDatabase();
    const bindings = createBindings(database);
    const server = createServer();
    const flow = createFlow();
    const serverSecretId = await storeMcpOAuthServerClientSecret(bindings as ApiBindings, {
      actor: createActor(),
      purpose: "oauth_server_create_client_secret",
      appId: APP_ID,
      secretKind: "server_client_secret",
      server,
      value: "server-client-secret",
    });
    const flowSecretId = await storeMcpOAuthFlowClientSecret(bindings as ApiBindings, {
      actor: createActor(),
      flow,
      purpose: "oauth_flow_start_client_secret",
      appId: APP_ID,
      secretKind: "flow_client_secret",
      value: "flow-client-secret",
    });

    await expect(
      readMcpOAuthServerClientSecret(bindings, {
        actor: createActor(),
        purpose: "oauth_authorization_client_secret",
        appId: APP_ID,
        secretKind: "server_client_secret",
        server: createServer({ byoClientSecretSecretId: serverSecretId }),
      }),
    ).resolves.toEqual({
      status: "allowed",
      value: "server-client-secret",
    });

    await expect(
      readMcpOAuthFlowClientSecret(bindings, {
        actor: createActor(),
        flow: createFlow({ oauthClientSecretSecretId: flowSecretId }),
        purpose: "oauth_callback_client_secret",
        appId: APP_ID,
        secretKind: "flow_client_secret",
        server: createServer(),
      }),
    ).resolves.toEqual({
      status: "allowed",
      value: "flow-client-secret",
    });
  });

  test("denies server client secret reads when scope or storage kind does not match", async () => {
    const database = createVaultDatabase();
    const bindings = createBindings(database);
    const wrongKindSecretId = await storeMcpOAuthFlowClientSecret(bindings as ApiBindings, {
      actor: createActor(),
      flow: createFlow(),
      purpose: "oauth_flow_start_client_secret",
      appId: APP_ID,
      secretKind: "flow_client_secret",
      value: "wrong-kind",
    });

    const cases: {
      actorAccountId?: AccountId;
      appId?: AppId;
      reason: McpOAuthSecretReadDenialReason;
      server?: Partial<ServerRow>;
    }[] = [
      {
        appId: OTHER_APP_ID,
        reason: "server_app_mismatch",
      },
      {
        reason: "server_auth_type_mismatch",
        server: { authType: "bearer" },
      },
      {
        actorAccountId: OTHER_ACCOUNT_ID,
        reason: "server_owner_mismatch",
      },
      {
        reason: "server_client_secret_missing",
        server: { byoClientSecretSecretId: null },
      },
      {
        reason: "secret_kind_mismatch",
        server: { byoClientSecretSecretId: wrongKindSecretId },
      },
      {
        reason: "secret_not_found",
      },
    ];

    for (const testCase of cases) {
      const outcome = await readMcpOAuthServerClientSecret(bindings, {
        actor: createActor(testCase.actorAccountId ?? OWNER_ID),
        purpose: "oauth_authorization_client_secret",
        appId: testCase.appId ?? APP_ID,
        secretKind: "server_client_secret",
        server: createServer(testCase.server),
      });

      expect(outcome).toMatchObject({
        reason: testCase.reason,
        status: "denied",
      });
    }
  });

  test("denies flow client secret reads when flow ownership does not match", async () => {
    const database = createVaultDatabase();
    const bindings = createBindings(database);
    const wrongKindSecretId = await storeMcpOAuthServerClientSecret(bindings as ApiBindings, {
      actor: createActor(),
      purpose: "oauth_server_create_client_secret",
      appId: APP_ID,
      secretKind: "server_client_secret",
      server: createServer(),
      value: "wrong-kind",
    });

    const cases: {
      actorAccountId?: AccountId;
      flow?: Partial<OAuthFlowRow>;
      appId?: AppId;
      reason: McpOAuthSecretReadDenialReason;
      server?: Partial<ServerRow>;
    }[] = [
      {
        flow: { appId: OTHER_APP_ID },
        reason: "flow_app_mismatch",
      },
      {
        flow: { serverId: OTHER_SERVER_ID },
        reason: "flow_server_mismatch",
      },
      {
        flow: { initiatorUserId: OTHER_ACCOUNT_ID },
        reason: "flow_initiator_mismatch",
      },
      {
        flow: { status: "failed" },
        reason: "flow_status_mismatch",
      },
      {
        flow: { oauthClientSecretSecretId: null },
        reason: "flow_client_secret_missing",
      },
      {
        flow: { oauthClientSecretSecretId: wrongKindSecretId },
        reason: "secret_kind_mismatch",
      },
      {
        reason: "secret_not_found",
      },
    ];

    for (const testCase of cases) {
      const outcome = await readMcpOAuthFlowClientSecret(bindings, {
        actor: createActor(testCase.actorAccountId ?? OWNER_ID),
        flow: createFlow(testCase.flow),
        purpose: "oauth_callback_client_secret",
        appId: testCase.appId ?? APP_ID,
        secretKind: "flow_client_secret",
        server: createServer(testCase.server),
      });

      expect(outcome).toMatchObject({
        reason: testCase.reason,
        status: "denied",
      });
    }
  });

  test("deletes flow client secrets only when the owner-scoped kind matches", async () => {
    const database = createVaultDatabase();
    const bindings = createBindings(database);
    const flow = createFlow();
    const flowSecretId = await storeMcpOAuthFlowClientSecret(bindings as ApiBindings, {
      actor: createActor(),
      flow,
      purpose: "oauth_flow_start_client_secret",
      appId: APP_ID,
      secretKind: "flow_client_secret",
      value: "flow-client-secret",
    });
    const wrongKindSecretId = await storeMcpOAuthServerClientSecret(bindings as ApiBindings, {
      actor: createActor(),
      purpose: "oauth_server_create_client_secret",
      appId: APP_ID,
      secretKind: "server_client_secret",
      server: createServer(),
      value: "server-client-secret",
    });

    await expect(
      deleteMcpOAuthFlowClientSecret(database, {
        actor: {
          name: "mcp_oauth_flow_terminal_cleanup",
          type: "system",
        },
        flow,
        purpose: "oauth_flow_terminal_cleanup",
        appId: APP_ID,
        secretId: wrongKindSecretId,
        secretKind: "flow_client_secret",
      }),
    ).resolves.toMatchObject({
      reason: "secret_kind_mismatch",
      status: "denied",
    });

    await expect(
      deleteMcpOAuthFlowClientSecret(database, {
        actor: {
          name: "mcp_oauth_flow_terminal_cleanup",
          type: "system",
        },
        flow,
        purpose: "oauth_flow_terminal_cleanup",
        appId: APP_ID,
        secretId: flowSecretId,
        secretKind: "flow_client_secret",
      }),
    ).resolves.toEqual({ status: "deleted" });

    await expect(
      readMcpOAuthFlowClientSecret(bindings, {
        actor: createActor(),
        flow: createFlow({ oauthClientSecretSecretId: flowSecretId }),
        purpose: "oauth_callback_client_secret",
        appId: APP_ID,
        secretKind: "flow_client_secret",
        server: createServer(),
      }),
    ).resolves.toMatchObject({
      reason: "secret_not_found",
      status: "denied",
    });
  });
});
