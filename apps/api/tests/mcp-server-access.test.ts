import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import {
  ensureServerAccess,
  ensureServerManageAccess,
} from "../src/modules/mcp/application/mcp-server.repository";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const OWNER_ID = "01J00000000000000000000001";
const MEMBER_ID = "01J00000000000000000000002";
const PROJECT_ID = "01J0000000000000000000000A";
const OTHER_PROJECT_ID = "01J0000000000000000000000B";
const PROJECT_MCP_SERVER_ID = "01J0000000000000000000000C";
const OTHER_PROJECT_MCP_SERVER_ID = "01J0000000000000000000000D";

function createMcpServerAccessDatabase(): SqliteD1Database {
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
      name text NOT NULL
    );

    CREATE TABLE mcp_server (
      auth_type text NOT NULL,
      byo_client_id text,
      byo_client_secret_secret_id text,
      created_at integer NOT NULL,
      credential_scope text NOT NULL,
      description text,
      enabled integer NOT NULL DEFAULT 1,
      icon_url text,
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      oauth_metadata_json text,
      owner_account_id text NOT NULL,
      project_id text NOT NULL,
      source text NOT NULL,
      updated_at integer NOT NULL,
      url text NOT NULL
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
    VALUES
      ('${PROJECT_ID}', '01J00000000000000000000006', '${OWNER_ID}', 'Project', 1, 1),
      ('${OTHER_PROJECT_ID}', '01J00000000000000000000006', '${MEMBER_ID}', 'Other Project', 1, 1);

    INSERT INTO account (id, name)
    VALUES ('${OWNER_ID}', 'Owner'), ('${MEMBER_ID}', 'Member');

    INSERT INTO mcp_server (
      auth_type,
      created_at,
      credential_scope,
      enabled,
      id,
      name,
      owner_account_id,
      project_id,
      source,
      updated_at,
      url
    )
    VALUES
      ('bearer', 1, 'app', 1, '${PROJECT_MCP_SERVER_ID}', 'Project MCP', '${OWNER_ID}', '${PROJECT_ID}', 'app', 1, 'https://mcp.example.com/project'),
      ('bearer', 1, 'app', 1, '${OTHER_PROJECT_MCP_SERVER_ID}', 'Other Project MCP', '${MEMBER_ID}', '${OTHER_PROJECT_ID}', 'app', 1, 'https://mcp.example.com/other-project');
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

describe("MCP server access", () => {
  test("resolves project owner access", async () => {
    const database = createMcpServerAccessDatabase();

    const access = await ensureServerAccess(
      database,
      createViewer(OWNER_ID),
      PROJECT_ID,
      PROJECT_MCP_SERVER_ID,
    );

    expect(access.server.id).toBe(PROJECT_MCP_SERVER_ID);
  });

  test("denies non-owner project access", async () => {
    const database = createMcpServerAccessDatabase();

    await expect(
      ensureServerAccess(database, createViewer(MEMBER_ID), PROJECT_ID, PROJECT_MCP_SERVER_ID),
    ).rejects.toThrow();
  });

  test("denies wrong-project server access", async () => {
    const database = createMcpServerAccessDatabase();

    await expect(
      ensureServerManageAccess(
        database,
        createViewer(OWNER_ID),
        PROJECT_ID,
        OTHER_PROJECT_MCP_SERVER_ID,
      ),
    ).rejects.toThrow();
  });
});
