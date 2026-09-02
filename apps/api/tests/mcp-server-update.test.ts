import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { updateProjectMcpServer } from "../src/modules/mcp/application/mcp-server-management.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const OWNER_ID = "01J00000000000000000000001";
const MEMBER_ID = "01J00000000000000000000002";
const PROJECT_ID = "01J00000000000000000000006";
const PROJECT_MCP_SERVER_ID = "01J0000000000000000000000A";
const PROJECT_CREDENTIAL_ID = "01J0000000000000000000000D";
const PROJECT_SECRET_ID = "01J0000000000000000000000F";

function createMcpServerUpdateDatabase(): SqliteD1Database {
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
    VALUES ('01J00000000000000000000007');

    INSERT INTO project (
      id,
      organization_id,
      owner_account_id,
      name,
      created_at,
      updated_at
    )
    VALUES ('${PROJECT_ID}', '01J00000000000000000000007', '${OWNER_ID}', 'Project', 1, 1);

    INSERT INTO account (id, email, image_url, name)
    VALUES
      ('${OWNER_ID}', 'owner@example.com', NULL, 'Owner'),
      ('${MEMBER_ID}', 'member@example.com', NULL, 'Member');

    INSERT INTO mcp_server (
      id,
      auth_type,
      created_at,
      credential_scope,
      description,
      enabled,
      icon_url,
      name,
      oauth_metadata_json,
      owner_account_id,
      project_id,
      source,
      updated_at,
      url
    )
    VALUES
      ('${PROJECT_MCP_SERVER_ID}', 'bearer', 1, 'app', 'Old description', 1, 'https://icons.example.com/old.png', 'Project MCP', '{"cached":true}', '${OWNER_ID}', '${PROJECT_ID}', 'app', 1, 'https://app.example.com/mcp');

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

  return database;
}

function createViewer(id: string): AuthenticatedViewer {
  return {
    email: `${id}@mosoo.ai`,
    emailVerified: true,
    id,
    imageUrl: null,
    name: id,
  };
}

describe("MCP server update", () => {
  test("updates editable fields and keeps the credential when the URL is unchanged", async () => {
    const database = createMcpServerUpdateDatabase();

    const server = await updateProjectMcpServer(database, createViewer(OWNER_ID), {
      projectId: PROJECT_ID,
      description: "New description",
      iconUrl: "https://icons.example.com/new.png",
      name: "Renamed MCP",
      serverId: PROJECT_MCP_SERVER_ID,
      url: "https://app.example.com/mcp",
    });

    expect(server.name).toBe("Renamed MCP");
    expect(server.description).toBe("New description");
    expect(server.iconUrl).toBe("https://icons.example.com/new.png");
    expect(server.url).toBe("https://app.example.com/mcp");
    expect(server.credentialStatus).toBe("active");
    expect(server.hasCredential).toBe(true);
  });

  test("clears description and icon when omitted", async () => {
    const database = createMcpServerUpdateDatabase();

    const server = await updateProjectMcpServer(database, createViewer(OWNER_ID), {
      projectId: PROJECT_ID,
      name: "Project MCP",
      serverId: PROJECT_MCP_SERVER_ID,
      url: "https://app.example.com/mcp",
    });

    expect(server.description).toBeNull();

    const statement = database
      .prepare("SELECT icon_url FROM mcp_server WHERE id = ?")
      .bind(PROJECT_MCP_SERVER_ID);
    const record = await statement.first<{ icon_url: string | null }>();
    expect(record?.icon_url).toBeNull();
  });

  test("revokes the project credential and clears cached OAuth metadata when the URL changes", async () => {
    const database = createMcpServerUpdateDatabase();

    const server = await updateProjectMcpServer(database, createViewer(OWNER_ID), {
      projectId: PROJECT_ID,
      description: "Old description",
      iconUrl: "https://icons.example.com/old.png",
      name: "Project MCP",
      serverId: PROJECT_MCP_SERVER_ID,
      url: "https://moved.example.com/mcp",
    });

    expect(server.url).toBe("https://moved.example.com/mcp");
    expect(server.credentialStatus).toBe("revoked");
    expect(server.hasCredential).toBe(false);

    const row = database
      .prepare("SELECT oauth_metadata_json FROM mcp_server WHERE id = ?")
      .bind(PROJECT_MCP_SERVER_ID);
    const record = await row.first<{ oauth_metadata_json: string | null }>();
    expect(record?.oauth_metadata_json).toBeNull();
  });

  test("rejects a non-https URL", async () => {
    const database = createMcpServerUpdateDatabase();

    await expect(
      updateProjectMcpServer(database, createViewer(OWNER_ID), {
        projectId: PROJECT_ID,
        name: "Project MCP",
        serverId: PROJECT_MCP_SERVER_ID,
        url: "http://app.example.com/mcp",
      }),
    ).rejects.toThrow();
  });

  test("denies non-owner updates", async () => {
    const database = createMcpServerUpdateDatabase();

    await expect(
      updateProjectMcpServer(database, createViewer(MEMBER_ID), {
        projectId: PROJECT_ID,
        name: "Hijacked MCP",
        serverId: PROJECT_MCP_SERVER_ID,
        url: "https://app.example.com/mcp",
      }),
    ).rejects.toThrow();
  });
});
