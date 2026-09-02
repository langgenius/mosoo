import { describe, expect, test } from "bun:test";

import { getMcpRegistry } from "../src/modules/mcp/application/mcp-registry.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const VIEWER_ID = "01J00000000000000000000002";
const PROJECT_ID = "01J00000000000000000000006";
const PROJECT_MCP_SERVER_ID = "01J0000000000000000000000A";
const PROJECT_MCP_SERVER_WITHOUT_CREDENTIAL_ID = "01J0000000000000000000000B";
const OTHER_OWNER_MCP_SERVER_ID = "01J0000000000000000000000C";
const PROJECT_CREDENTIAL_ID = "01J0000000000000000000000D";
const PROJECT_SECRET_ID = "01J0000000000000000000000F";

function createMcpRegistryDatabase(input: { includeServers?: boolean } = {}): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });
  const includeServers = input.includeServers ?? true;

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
      owner_account_id text NOT NULL,
      project_id text NOT NULL,
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
      project_id text NOT NULL,
      refresh_secret_id text,
      scope text NOT NULL,
      scope_values_json text,
      secret_id text NOT NULL,
      server_id text NOT NULL,
      status text NOT NULL,
      subject_label text,
      updated_at integer NOT NULL
    );

	    INSERT INTO organization (id)
	    VALUES ('01J00000000000000000000006');

    INSERT INTO project (
      id,
      organization_id,
      owner_account_id,
      name,
      created_at,
      updated_at
    )
    VALUES ('${PROJECT_ID}', '01J00000000000000000000006', '${VIEWER_ID}', 'Project', 1, 1);

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
      owner_account_id,
      project_id,
      source,
      updated_at,
      url
    )
    VALUES
      ('${PROJECT_MCP_SERVER_ID}', 'bearer', 1, 'app', NULL, 1, 'Project MCP', '${VIEWER_ID}', '${PROJECT_ID}', 'app', 1, 'https://app.example.com/mcp'),
      ('${PROJECT_MCP_SERVER_WITHOUT_CREDENTIAL_ID}', 'bearer', 2, 'app', NULL, 1, 'Unconfigured MCP', '${VIEWER_ID}', '${PROJECT_ID}', 'app', 2, 'https://unconfigured.example.com/mcp'),
      ('${OTHER_OWNER_MCP_SERVER_ID}', 'bearer', 3, 'app', NULL, 1, 'Other Owner MCP', '01J00000000000000000000001', '${PROJECT_ID}', 'app', 3, 'https://other-owner.example.com/mcp');

    INSERT INTO mcp_credential (
      id,
      account_id,
      agent_id,
      auth_type,
      created_at,
      expires_at,
      last_refreshed_at,
      project_id,
      scope,
      scope_values_json,
      secret_id,
      server_id,
      status,
      subject_label,
      updated_at
    )
    VALUES
      ('${PROJECT_CREDENTIAL_ID}', NULL, NULL, 'bearer', 1, NULL, NULL, '${PROJECT_ID}', 'app', '[]', '${PROJECT_SECRET_ID}', '${PROJECT_MCP_SERVER_ID}', 'active', 'Project token', 1);
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
      PROJECT_ID,
    );

    expect(registry.servers).toHaveLength(2);
    expect(
      registry.servers.find((server) => server.id === PROJECT_MCP_SERVER_ID)?.hasCredential,
    ).toBe(true);
    expect(
      registry.servers.find((server) => server.id === PROJECT_MCP_SERVER_WITHOUT_CREDENTIAL_ID)
        ?.hasCredential,
    ).toBe(false);
    expect(registry.servers.some((server) => server.id === OTHER_OWNER_MCP_SERVER_ID)).toBe(false);
  });

  test("loads empty registries for project owners", async () => {
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
      PROJECT_ID,
    );

    expect(registry.servers).toEqual([]);
    expect(registry.currentUserName).toBe("Viewer");
  });
});
