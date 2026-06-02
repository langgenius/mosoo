import { describe, expect, test } from "bun:test";

import type { AccountId, AgentId, CredentialId, DriverInstanceId, McpServerId } from "@mosoo/id";
import { Hono } from "hono";

import { registerDriverRoute } from "../src/adapters/http/routes/driver-route";
import { replaceMcpCredentialSecret } from "../src/modules/mcp/application/mcp-credential-secret-resolution";
import type { ServerRow } from "../src/modules/mcp/application/mcp-types";
import { createRuntimeActionToken } from "../src/modules/runtime/infrastructure/runtime-boot-token";
import type { ApiBindings, ApiGatewayEnvironment } from "../src/platform/cloudflare/worker-types";
import { createTestExecutionContext } from "./helpers/published-agent-http-test-fixture";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const ORGANIZATION_ID = "01J00000000000000000000006";
const OWNER_ID = "01J00000000000000000000001" as AccountId;
const CALLER_ID = "01J00000000000000000000002" as AccountId;
const AGENT_ID = "01J00000000000000000000009" as AgentId;
const SESSION_ID = "01J0000000000000000000000C";
const SESSION_RUN_ID = "01J0000000000000000000000N";
const SANDBOX_ID = "01J0000000000000000000000D";
const DRIVER_INSTANCE_ID = "01J0000000000000000000000F" as DriverInstanceId;
const MCP_SERVER_ID = "01J0000000000000000000000M" as McpServerId;
const MCP_CREDENTIAL_ID = "01J0000000000000000000000Q" as CredentialId;

const MCP_SERVER_ROW = {
  authType: "bearer",
  byoClientId: null,
  byoClientSecretSecretId: null,
  createdAt: 1,
  credentialScope: "user",
  description: null,
  enabled: 1,
  iconUrl: null,
  id: MCP_SERVER_ID,
  name: "Linear",
  oauthMetadataJson: null,
  organizationId: ORGANIZATION_ID,
  ownerId: OWNER_ID,
  ownerName: "Owner",
  source: "organization_shared",
  updatedAt: 1,
  url: "https://mcp.example.com",
} as const satisfies ServerRow;

function createDriverRouteTestApp(): Hono<ApiGatewayEnvironment> {
  const app = new Hono<ApiGatewayEnvironment>();
  registerDriverRoute(app);
  return app;
}

function createRuntimeProxyDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE account (
      id text PRIMARY KEY NOT NULL,
      email text,
      image_url text,
      name text NOT NULL
    );

    CREATE TABLE agent (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL
    );

    CREATE TABLE session (
      id text PRIMARY KEY NOT NULL,
      agent_id text NOT NULL,
      creator_account_id text NOT NULL,
      organization_id text NOT NULL
    );

    CREATE TABLE session_run (
      id text PRIMARY KEY NOT NULL,
      session_id text NOT NULL,
      created_by_account_id text NOT NULL,
      driver_instance_id text,
      trace_id text NOT NULL,
      status text NOT NULL
    );

    CREATE TABLE sandbox (
      id text PRIMARY KEY NOT NULL,
      kind text NOT NULL,
      subject_kind text NOT NULL
    );

    CREATE TABLE sandbox_session (
      session_id text PRIMARY KEY NOT NULL,
      origin_json text NOT NULL
    );

    CREATE TABLE driver_instance (
      boot_token_expires_at integer NOT NULL,
      boot_token_hash blob NOT NULL,
      boot_token_used_at integer,
      close_code integer,
      close_reason text,
      connection_id text,
      created_at integer NOT NULL,
      driver_pid integer,
      driver_started_at integer,
      driver_version text,
      error_message text,
      expires_at integer NOT NULL,
      heartbeat_count integer NOT NULL,
      id text PRIMARY KEY NOT NULL,
      last_heartbeat_at integer,
      process_id text,
      protocol text NOT NULL,
      protocol_version integer NOT NULL,
      generation integer DEFAULT 0 NOT NULL,
      restart_count integer DEFAULT 0 NOT NULL,
      runtime text NOT NULL,
      sandbox_id text NOT NULL,
      sandbox_session_id text NOT NULL,
      status text NOT NULL,
      status_changed_at integer DEFAULT 0 NOT NULL,
      status_event text DEFAULT 'driver.provision' NOT NULL,
      status_operation_id text,
      status_seq integer DEFAULT 0 NOT NULL,
      status_source text DEFAULT 'system' NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE driver_instance_mcp_grant (
      auth_type text NOT NULL,
      authorization_state text NOT NULL,
      can_invalidate integer DEFAULT 0 NOT NULL,
      can_refresh integer DEFAULT 0 NOT NULL,
      created_at integer NOT NULL,
      credential_id text,
      driver_instance_id text NOT NULL,
      server_id text NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE mcp_server (
      auth_type text NOT NULL,
      byo_client_id text,
      byo_client_secret_secret_id text,
      created_at integer NOT NULL,
      credential_scope text NOT NULL,
      description text,
      enabled integer DEFAULT 1 NOT NULL,
      icon_url text,
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      oauth_metadata_json text,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      source text NOT NULL,
      updated_at integer NOT NULL,
      url text NOT NULL
    );

    CREATE TABLE mcp_credential (
      account_id text,
      agent_id text,
      auth_type text NOT NULL,
      created_at integer NOT NULL,
      expires_at integer,
      id text PRIMARY KEY NOT NULL,
      last_refreshed_at integer,
      oauth_client_id text,
      oauth_client_secret_secret_id text,
      refresh_secret_id text,
      scope text NOT NULL,
      scope_values_json text,
      secret_id text NOT NULL,
      server_id text NOT NULL,
      status text NOT NULL,
      subject_label text,
      updated_at integer NOT NULL
    );

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

    CREATE TABLE audit_event (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      timestamp integer NOT NULL,
      actor_type text NOT NULL,
      actor_id text,
      actor_display text NOT NULL,
      action text NOT NULL,
      resource_type text NOT NULL,
      resource_id text,
      resource_display text,
      outcome text NOT NULL,
      ip_address text,
      user_agent text,
      correlation_id text,
      metadata_json text,
      session_id text,
      before_json text,
      after_json text
    );
  `);

  database.execute(`
    INSERT INTO account (id, email, image_url, name)
    VALUES ('${OWNER_ID}', 'owner@example.com', NULL, 'Owner');

    INSERT INTO agent (id, organization_id, owner_account_id)
    VALUES ('${AGENT_ID}', '${ORGANIZATION_ID}', '${OWNER_ID}');

    INSERT INTO session (id, agent_id, creator_account_id, organization_id)
    VALUES ('${SESSION_ID}', '${AGENT_ID}', '${CALLER_ID}', '${ORGANIZATION_ID}');

    INSERT INTO session_run (
      id,
      session_id,
      created_by_account_id,
      driver_instance_id,
      trace_id,
      status
    )
    VALUES (
      '${SESSION_RUN_ID}',
      '${SESSION_ID}',
      '${CALLER_ID}',
      '${DRIVER_INSTANCE_ID}',
      '11111111111111111111111111111111',
      'running'
    );

    INSERT INTO sandbox (id, kind, subject_kind)
    VALUES ('${SANDBOX_ID}', 'pet', 'agent');

    INSERT INTO sandbox_session (session_id, origin_json)
    VALUES ('${SESSION_ID}', '');

    INSERT INTO driver_instance (
      boot_token_expires_at,
      boot_token_hash,
      boot_token_used_at,
      created_at,
      expires_at,
      heartbeat_count,
      id,
      protocol,
      protocol_version,
      generation,
      runtime,
      sandbox_id,
      sandbox_session_id,
      status,
      updated_at
    ) VALUES (
      4102444800000,
      X'01',
      1,
      1,
      4102444800000,
      0,
      '${DRIVER_INSTANCE_ID}',
      'orpc',
      1,
      0,
      'claude-agent-sdk',
      '${SANDBOX_ID}',
      '${SESSION_ID}',
      'ready',
      1
    );

    INSERT INTO driver_instance_mcp_grant (
      auth_type,
      authorization_state,
      can_invalidate,
      can_refresh,
      created_at,
      credential_id,
      driver_instance_id,
      server_id,
      updated_at
    ) VALUES (
      'bearer',
      'active',
      0,
      0,
      1,
      '${MCP_CREDENTIAL_ID}',
      '${DRIVER_INSTANCE_ID}',
      '${MCP_SERVER_ID}',
      1
    );

    INSERT INTO mcp_server (
      auth_type,
      byo_client_id,
      byo_client_secret_secret_id,
      created_at,
      credential_scope,
      description,
      enabled,
      icon_url,
      id,
      name,
      oauth_metadata_json,
      organization_id,
      owner_account_id,
      source,
      updated_at,
      url
    ) VALUES (
      'bearer',
      NULL,
      NULL,
      1,
      'user',
      NULL,
      1,
      NULL,
      '${MCP_SERVER_ID}',
      'Linear',
      NULL,
      '${ORGANIZATION_ID}',
      '${OWNER_ID}',
      'organization_shared',
      1,
      'https://mcp.example.com'
    );
  `);

  return database;
}

function createBindings(database: D1Database): ApiBindings {
  return {
    DB: database,
    RUNTIME_ACTION_TOKEN_SECRET: "test-runtime-action-token",
    VAULT_ROOT_SECRET: "test-vault-secret",
  } as ApiBindings;
}

describe("runtime MCP proxy public error audit", () => {
  test("uses one owner for public credential errors and denied audit metadata", async () => {
    const database = createRuntimeProxyDatabase();
    const bindings = createBindings(database);
    const wrongKind = "mcp_credential:wrong-owner:access_token";
    const accessSecretId = await replaceMcpCredentialSecret(bindings, {
      agentId: null,
      credentialId: MCP_CREDENTIAL_ID,
      currentSecretId: null,
      purpose: "credential_access_token",
      scope: "user",
      secretKind: "access_token",
      server: MCP_SERVER_ROW,
      userId: OWNER_ID,
      value: "access-token-value",
    });

    if (accessSecretId === null) {
      throw new Error("Expected MCP credential access secret.");
    }

    await database
      .prepare("UPDATE vault_secret SET kind = ? WHERE id = ?")
      .bind(wrongKind, accessSecretId)
      .run();

    await database
      .prepare(
        `
          INSERT INTO mcp_credential (
            account_id,
            agent_id,
            auth_type,
            created_at,
            expires_at,
            id,
            last_refreshed_at,
            oauth_client_id,
            oauth_client_secret_secret_id,
            refresh_secret_id,
            scope,
            scope_values_json,
            secret_id,
            server_id,
            status,
            subject_label,
            updated_at
          ) VALUES (?, NULL, 'bearer', 1, NULL, ?, NULL, NULL, NULL, NULL, 'user', '[]', ?, ?, 'active', NULL, 1)
        `,
      )
      .bind(OWNER_ID, MCP_CREDENTIAL_ID, accessSecretId, MCP_SERVER_ID)
      .run();

    const grant = await createRuntimeActionToken(bindings, {
      action: "mcp_proxy",
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: Date.now() + 60_000,
      resourceId: MCP_SERVER_ID,
    });
    const response = await createDriverRouteTestApp().request(
      new Request(`https://api.example.com/api/driver/mcp/proxy/${MCP_SERVER_ID}`, {
        headers: {
          Authorization: `Bearer ${grant}`,
          "x-correlation-id": "runtime-proxy-denied",
          "x-request-id": "runtime-proxy-request",
        },
        method: "POST",
      }),
      undefined,
      bindings,
      createTestExecutionContext(),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: "mcp_credential_unavailable",
      error: "MCP credential is unavailable.",
    });

    const auditRow = await database
      .prepare(
        `
          SELECT
            action,
            actor_id,
            actor_type,
            correlation_id,
            metadata_json,
            outcome,
            resource_id,
            resource_type,
            session_id
          FROM audit_event
        `,
      )
      .first<{
        action: string;
        actor_id: string | null;
        actor_type: string;
        correlation_id: string | null;
        metadata_json: string | null;
        outcome: string;
        resource_id: string | null;
        resource_type: string;
        session_id: string | null;
      }>();

    expect(auditRow).toMatchObject({
      action: "mcp_binding.update",
      actor_id: AGENT_ID,
      actor_type: "agent",
      correlation_id: "runtime-proxy-denied",
      outcome: "denied",
      resource_id: MCP_SERVER_ID,
      resource_type: "mcp_binding",
      session_id: SESSION_ID,
    });

    const metadata = JSON.parse(auditRow?.metadata_json ?? "{}") as Record<string, unknown>;
    expect(metadata).toMatchObject({
      callerId: CALLER_ID,
      credentialId: MCP_CREDENTIAL_ID,
      driverInstanceId: DRIVER_INSTANCE_ID,
      errorCode: "mcp_credential_unavailable",
      executionOwnerId: OWNER_ID,
      mcpSecretReadPurpose: "runtime_access_token",
      mcpSecretReadReason: "secret_kind_mismatch",
      operation: "runtime.mcp_proxy",
      reason: "credential_secret_denied",
      requestId: "runtime-proxy-request",
      serverId: MCP_SERVER_ID,
      status: 401,
    });
    const serializedMetadata = JSON.stringify(metadata);
    expect(serializedMetadata).not.toContain(accessSecretId);
    expect(serializedMetadata).not.toContain(wrongKind);
    expect(serializedMetadata).not.toContain("access-token-value");
  });
});
