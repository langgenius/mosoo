import { describe, expect, test } from "bun:test";

import { PUBLIC_API_PREFIX } from "@mosoo/contracts/public-api";

import { createHttpApp } from "../src/adapters/http/create-http-app";
import {
  authenticatePersonalAccessToken,
  createPersonalAccessToken,
  hashTokenValue,
  listPersonalAccessTokens,
  revokePersonalAccessToken,
} from "../src/modules/auth/application/personal-access-token.service";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  TOKENS,
} from "./helpers/public-api-http-test-fixture";
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
	      creator_account_id text,
	      name text NOT NULL,
	      updated_at integer NOT NULL
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
	      creator_account_id,
	      name,
	      updated_at
	    )
	    VALUES ('01J00000000000000000000006', NULL, 1, '01J00000000000000000000001', 'Acme', 1);

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
  test("creates a token over HTTP with Bearer authentication", async () => {
    const database = await createPublicHttpContractDatabase();
    const response = await createHttpApp().request(
      `${PUBLIC_API_PREFIX}/access-tokens`,
      {
        body: JSON.stringify({ label: "CLI token" }),
        headers: {
          authorization: `Bearer ${TOKENS.owner}`,
          "content-type": "application/json",
        },
        method: "POST",
      },
      createPublicHttpTestBindings(database) as ApiBindings,
    );

    expect(response.status).toBe(201);
  });

  test("generates Mosoo access tokens with the MST prefix", async () => {
    const database = createPersonalTokenDatabase();

    const response = await createPersonalAccessToken(database, VIEWER, {
      label: "Deploy key",
    });

    expect(response.value).toStartWith("mst_");
  });

  test("accepts legacy Growth PAT tokens for existing hashes", async () => {
    const database = createPersonalTokenDatabase();
    const legacyTokenValue = "grt_pat_legacy_token_value";
    const legacyTokenHash = await hashTokenValue(legacyTokenValue);

    database.execute(`
      UPDATE personal_access_token
      SET token_hash = '${legacyTokenHash}'
      WHERE id = '${TOKEN_ID}';
    `);

    const caller = await authenticatePersonalAccessToken(database, legacyTokenValue);

    expect(caller?.tokenId).toBe(TOKEN_ID);
  });

  test("keeps missing token revocation a no-op", async () => {
    const database = createPersonalTokenTable();

    await revokePersonalAccessToken(database, VIEWER, MISSING_TOKEN_ID);

    const tokenCount = await database
      .prepare("SELECT COUNT(*) AS count FROM personal_access_token")
      .first<{ count: number }>();

    expect(tokenCount?.count).toBe(0);
  });

  test("revokes an owned token", async () => {
    const innerDatabase = createPersonalTokenDatabase();

    await revokePersonalAccessToken(innerDatabase, VIEWER, TOKEN_ID);

    const token = await innerDatabase
      .prepare(`SELECT revoked_at FROM personal_access_token WHERE id = '${TOKEN_ID}'`)
      .first<{ revoked_at: number | null }>();

    expect(token?.revoked_at).toBeNumber();
  });

  test("omits revoked tokens from the token list", async () => {
    const database = createPersonalTokenDatabase();

    await revokePersonalAccessToken(database, VIEWER, TOKEN_ID);

    const response = await listPersonalAccessTokens(database, VIEWER);

    expect(response.tokens).toEqual([]);
  });
});
