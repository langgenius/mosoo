import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import {
  ensureServerAccess,
  ensureServerManageAccess,
} from "../src/modules/mcp/application/mcp-server.repository";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const OWNER_ID = "01J00000000000000000000001";
const MEMBER_ID = "01J00000000000000000000002";
const APP_ID = "01J0000000000000000000000A";
const OTHER_APP_ID = "01J0000000000000000000000B";
const APP_MCP_SERVER_ID = "01J0000000000000000000000C";
const OTHER_APP_MCP_SERVER_ID = "01J0000000000000000000000D";

function createMcpServerAccessDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
	    CREATE TABLE organization (
	      id text PRIMARY KEY NOT NULL
	    );

    CREATE TABLE app (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      slug text NOT NULL,
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
      app_id text NOT NULL,
      source text NOT NULL,
      updated_at integer NOT NULL,
      url text NOT NULL
    );

	    INSERT INTO organization (id)
	    VALUES ('01J00000000000000000000006');

    INSERT INTO app (
      id,
      organization_id,
      owner_account_id,
      slug,
      name,
      created_at,
      updated_at
    )
    VALUES
      ('${APP_ID}', '01J00000000000000000000006', '${OWNER_ID}', 'app', 'App', 1, 1),
      ('${OTHER_APP_ID}', '01J00000000000000000000006', '${MEMBER_ID}', 'other-app', 'Other App', 1, 1);

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
      app_id,
      source,
      updated_at,
      url
    )
    VALUES
      ('bearer', 1, 'app', 1, '${APP_MCP_SERVER_ID}', 'App MCP', '${OWNER_ID}', '${APP_ID}', 'app', 1, 'https://mcp.example.com/app'),
      ('bearer', 1, 'app', 1, '${OTHER_APP_MCP_SERVER_ID}', 'Other App MCP', '${MEMBER_ID}', '${OTHER_APP_ID}', 'app', 1, 'https://mcp.example.com/other-app');
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
  test("resolves app owner access", async () => {
    const database = createMcpServerAccessDatabase();

    const access = await ensureServerAccess(
      database,
      createViewer(OWNER_ID),
      APP_ID,
      APP_MCP_SERVER_ID,
    );

    expect(access.server.id).toBe(APP_MCP_SERVER_ID);
  });

  test("denies non-owner app access", async () => {
    const database = createMcpServerAccessDatabase();

    await expect(
      ensureServerAccess(database, createViewer(MEMBER_ID), APP_ID, APP_MCP_SERVER_ID),
    ).rejects.toThrow();
  });

  test("denies wrong-app server access", async () => {
    const database = createMcpServerAccessDatabase();

    await expect(
      ensureServerManageAccess(database, createViewer(OWNER_ID), APP_ID, OTHER_APP_MCP_SERVER_ID),
    ).rejects.toThrow();
  });
});
