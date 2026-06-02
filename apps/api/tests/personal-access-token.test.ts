import { describe, expect, test } from "bun:test";

import { revokePersonalAccessToken } from "../src/modules/auth/application/personal-access-token.service";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const MISSING_TOKEN_ID = "01J000000000000000000000K6";
const TOKEN_ID = "01J000000000000000000000K7";

const VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: "01J00000000000000000000001",
  imageUrl: null,
  name: "Owner",
};

function createPersonalTokenTable(): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE personal_access_token (
      id text PRIMARY KEY NOT NULL,
      account_id text NOT NULL,
      label text NOT NULL,
      token_hash text NOT NULL,
      last_used_at integer,
      revoked_at integer,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );
  `);

  return database;
}

function createPersonalTokenDatabase(): SqliteD1Database {
  const database = createPersonalTokenTable();

  database.execute(`
    CREATE TABLE account (
      id text PRIMARY KEY NOT NULL,
      email text NOT NULL,
      email_verified integer NOT NULL,
      image_url text,
      last_active_organization_id text,
      name text NOT NULL,
      system_agent_model text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE organization (
      id text PRIMARY KEY NOT NULL,
      avatar_url text,
      created_at integer NOT NULL,
      join_policy text NOT NULL,
      kind text NOT NULL,
      name text NOT NULL,
      primary_domain text,
      slug text NOT NULL
    );

    CREATE TABLE organization_member (
      organization_id text NOT NULL,
      account_id text NOT NULL,
      role text NOT NULL,
      disabled_at integer,
      disabled_by_account_id text,
      created_at integer NOT NULL,
      joined_at integer NOT NULL,
      PRIMARY KEY (organization_id, account_id)
    );

    CREATE TABLE audit_event (
      action text NOT NULL,
      after_json text,
      actor_display text NOT NULL,
      actor_id text,
      actor_type text NOT NULL,
      before_json text,
      correlation_id text,
      id text PRIMARY KEY NOT NULL,
      ip_address text,
      metadata_json text,
      organization_id text NOT NULL,
      outcome text NOT NULL,
      resource_display text,
      resource_id text,
      resource_type text NOT NULL,
      session_id text,
      timestamp integer NOT NULL,
      user_agent text
    );

    INSERT INTO account (
      id,
      email,
      email_verified,
      image_url,
      last_active_organization_id,
      name,
      system_agent_model,
      created_at,
      updated_at
    )
    VALUES ('01J00000000000000000000001', 'owner@example.com', 1, NULL, '01J00000000000000000000006', 'Owner', NULL, 1, 1);

    INSERT INTO organization (
      id,
      avatar_url,
      created_at,
      join_policy,
      kind,
      name,
      primary_domain,
      slug
    )
    VALUES ('01J00000000000000000000006', NULL, 1, 'request', 'team', 'Acme', NULL, 'acme');

    INSERT INTO organization_member (
      organization_id,
      account_id,
      role,
      disabled_at,
      disabled_by_account_id,
      created_at,
      joined_at
    )
    VALUES ('01J00000000000000000000006', '01J00000000000000000000001', 'owner', NULL, NULL, 1, 1);

    INSERT INTO personal_access_token (
      id,
      account_id,
      label,
      token_hash,
      last_used_at,
      revoked_at,
      created_at,
      updated_at
    )
    VALUES ('${TOKEN_ID}', '01J00000000000000000000001', 'Deploy key', 'hash-1', NULL, NULL, 1, 1);
  `);

  return database;
}

describe("personal access tokens", () => {
  test("keeps missing token revocation a no-op", async () => {
    const database = createPersonalTokenTable();

    await revokePersonalAccessToken(database, VIEWER, MISSING_TOKEN_ID);

    const tokenCount = await database
      .prepare("SELECT COUNT(*) AS count FROM personal_access_token")
      .first<{ count: number }>();

    expect(tokenCount?.count).toBe(0);
  });

  test("revokes an owned token and records audit metadata", async () => {
    const innerDatabase = createPersonalTokenDatabase();

    await revokePersonalAccessToken(innerDatabase, VIEWER, TOKEN_ID);

    const token = await innerDatabase
      .prepare(`SELECT revoked_at FROM personal_access_token WHERE id = '${TOKEN_ID}'`)
      .first<{ revoked_at: number | null }>();
    const auditEvent = await innerDatabase
      .prepare(`SELECT resource_id FROM audit_event WHERE resource_id = '${TOKEN_ID}'`)
      .first<{ resource_id: string }>();

    expect(token?.revoked_at).toBeNumber();
    expect(auditEvent?.resource_id).toBe(TOKEN_ID);
  });
});
