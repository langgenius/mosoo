import { describe, expect, test } from "bun:test";

import { getMcpRegistry } from "../src/modules/mcp/application/mcp-registry.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const VIEWER_ID = "01J00000000000000000000002";
const PERSONAL_MCP_SERVER_ID = "01J0000000000000000000000A";
const SHARED_MCP_SERVER_ID = "01J0000000000000000000000B";
const ORG_USER_MCP_SERVER_ID = "01J0000000000000000000000C";
const PERSONAL_CREDENTIAL_ID = "01J0000000000000000000000D";
const SHARED_CREDENTIAL_ID = "01J0000000000000000000000E";
const PERSONAL_SECRET_ID = "01J0000000000000000000000F";
const SHARED_SECRET_ID = "01J0000000000000000000000G";

function createMcpRegistryDatabase(input: { includeServers?: boolean } = {}): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });
  const includeServers = input.includeServers ?? true;

  database.execute(`
    CREATE TABLE organization (
      id text PRIMARY KEY NOT NULL,
      join_policy text NOT NULL
    );

    CREATE TABLE organization_member (
      organization_id text NOT NULL,
      account_id text NOT NULL,
      role text NOT NULL,
      disabled_at integer,
      PRIMARY KEY (organization_id, account_id)
    );

    CREATE TABLE account (
      id text PRIMARY KEY NOT NULL,
      email text,
      image_url text,
      name text
    );

    CREATE TABLE mcp_server (
      id text PRIMARY KEY NOT NULL,
      auth_type text NOT NULL,
      byo_client_id text,
      byo_client_secret_secret_id text,
      created_at integer NOT NULL,
      credential_scope text NOT NULL,
      description text,
      enabled integer NOT NULL,
      icon_url text,
      name text NOT NULL,
      oauth_metadata_json text,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      source text NOT NULL,
      updated_at integer NOT NULL,
      url text NOT NULL
    );

    CREATE TABLE mcp_credential (
      id text PRIMARY KEY NOT NULL,
      account_id text,
      agent_id text,
      auth_type text NOT NULL,
      created_at integer NOT NULL,
      expires_at integer,
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

    INSERT INTO organization (id, join_policy)
    VALUES ('01J00000000000000000000006', 'invite_only');

    INSERT INTO organization_member (organization_id, account_id, role, disabled_at)
    VALUES ('01J00000000000000000000006', '${VIEWER_ID}', 'member', NULL);

    INSERT INTO account (id, email, image_url, name)
    VALUES
      ('${VIEWER_ID}', 'viewer@example.com', NULL, 'Viewer'),
      ('01J00000000000000000000001', 'owner@example.com', NULL, 'Owner');
  `);

  if (includeServers) {
    database.execute(`
    INSERT INTO mcp_server (
      id,
      auth_type,
      created_at,
      credential_scope,
      description,
      enabled,
      name,
      organization_id,
      owner_account_id,
      source,
      updated_at,
      url
    )
    VALUES
      ('${PERSONAL_MCP_SERVER_ID}', 'bearer', 1, 'user', NULL, 1, 'Personal', '01J00000000000000000000006', '${VIEWER_ID}', 'personal', 1, 'https://personal.example.com/mcp'),
      ('${SHARED_MCP_SERVER_ID}', 'bearer', 2, 'organization_shared', NULL, 1, 'Shared', '01J00000000000000000000006', '01J00000000000000000000001', 'organization_shared', 2, 'https://shared.example.com/mcp'),
      ('${ORG_USER_MCP_SERVER_ID}', 'bearer', 3, 'user', NULL, 1, 'Org User', '01J00000000000000000000006', '01J00000000000000000000001', 'organization_shared', 3, 'https://org-user.example.com/mcp');

    INSERT INTO mcp_credential (
      id,
      account_id,
      agent_id,
      auth_type,
      created_at,
      expires_at,
      last_refreshed_at,
      scope,
      scope_values_json,
      secret_id,
      server_id,
      status,
      subject_label,
      updated_at
    )
    VALUES
      ('${PERSONAL_CREDENTIAL_ID}', '${VIEWER_ID}', NULL, 'bearer', 1, NULL, NULL, 'user', '[]', '${PERSONAL_SECRET_ID}', '${PERSONAL_MCP_SERVER_ID}', 'active', 'Viewer token', 1),
      ('${SHARED_CREDENTIAL_ID}', NULL, NULL, 'bearer', 2, NULL, NULL, 'organization_shared', '[]', '${SHARED_SECRET_ID}', '${SHARED_MCP_SERVER_ID}', 'active', 'Service account', 2);
  `);
  }

  return database;
}

describe("MCP registry", () => {
  test("derives shared credential availability from registry credential rows", async () => {
    const database = createMcpRegistryDatabase();

    const registry = await getMcpRegistry(
      database,
      {
        email: "viewer@example.com",
        emailVerified: true,
        id: VIEWER_ID,
        imageUrl: null,
        name: "Viewer",
      },
      "01J00000000000000000000006",
    );

    expect(registry.personal).toHaveLength(1);
    expect(registry.organizationShared).toHaveLength(2);
    expect(
      registry.organizationShared.find((server) => server.id === SHARED_MCP_SERVER_ID)
        ?.hasSharedCredential,
    ).toBe(true);
    expect(
      registry.organizationShared.find((server) => server.id === ORG_USER_MCP_SERVER_ID)
        ?.hasSharedCredential,
    ).toBe(false);
  });

  test("loads empty registries for active members", async () => {
    const database = createMcpRegistryDatabase({ includeServers: false });

    const registry = await getMcpRegistry(
      database,
      {
        email: "viewer@example.com",
        emailVerified: true,
        id: VIEWER_ID,
        imageUrl: null,
        name: "Viewer",
      },
      "01J00000000000000000000006",
    );

    expect(registry.personal).toEqual([]);
    expect(registry.organizationShared).toEqual([]);
    expect(registry.currentUserName).toBe("Viewer");
  });
});
