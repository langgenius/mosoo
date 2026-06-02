import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import {
  ensureServerAccess,
  ensureServerManageAccess,
} from "../src/modules/mcp/application/mcp-server.repository";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const OWNER_ID = "01J00000000000000000000001";
const MEMBER_ID = "01J00000000000000000000002";
const ADMIN_ID = "01J00000000000000000000003";
const PERSONAL_MCP_SERVER_ID = "01J0000000000000000000000A";
const SHARED_MCP_SERVER_ID = "01J0000000000000000000000B";

function createMcpServerAccessDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

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
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      source text NOT NULL,
      updated_at integer NOT NULL,
      url text NOT NULL
    );

    INSERT INTO organization (id, join_policy)
    VALUES ('01J00000000000000000000006', 'invite_only');

    INSERT INTO organization_member (organization_id, account_id, role, disabled_at)
    VALUES
      ('01J00000000000000000000006', '${OWNER_ID}', 'member', NULL),
      ('01J00000000000000000000006', '${MEMBER_ID}', 'member', NULL),
      ('01J00000000000000000000006', '${ADMIN_ID}', 'admin', NULL);

    INSERT INTO account (id, name)
    VALUES ('${OWNER_ID}', 'Owner');

    INSERT INTO mcp_server (
      auth_type,
      created_at,
      credential_scope,
      enabled,
      id,
      name,
      organization_id,
      owner_account_id,
      source,
      updated_at,
      url
    )
    VALUES
      ('bearer', 1, 'user', 1, '${PERSONAL_MCP_SERVER_ID}', 'Personal', '01J00000000000000000000006', '${OWNER_ID}', 'personal', 1, 'https://mcp.example.com/personal'),
      ('bearer', 1, 'user', 1, '${SHARED_MCP_SERVER_ID}', 'Shared', '01J00000000000000000000006', '${OWNER_ID}', 'organization_shared', 1, 'https://mcp.example.com/shared');
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
  test("resolves personal owner access", async () => {
    const database = createMcpServerAccessDatabase();

    const access = await ensureServerAccess(
      database,
      createViewer(OWNER_ID),
      PERSONAL_MCP_SERVER_ID,
    );

    expect(access.server.id).toBe(PERSONAL_MCP_SERVER_ID);
    expect(access.membership.role).toBe("member");
  });

  test("denies non-owner personal access", async () => {
    const database = createMcpServerAccessDatabase();

    await expect(
      ensureServerAccess(database, createViewer(MEMBER_ID), PERSONAL_MCP_SERVER_ID),
    ).rejects.toThrow();
  });

  test("resolves organization management access", async () => {
    const database = createMcpServerAccessDatabase();

    const access = await ensureServerManageAccess(
      database,
      createViewer(ADMIN_ID),
      SHARED_MCP_SERVER_ID,
    );

    expect(access.server.id).toBe(SHARED_MCP_SERVER_ID);
    expect(access.membership.role).toBe("admin");
  });
});
