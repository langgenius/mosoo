import { describe, expect, test } from "bun:test";

import { hashTokenValue } from "../src/modules/auth/application/personal-access-token.service";
import {
  authenticatePublicApiCaller,
  authenticateOrganizationServiceToken,
} from "../src/modules/auth/application/public-api-caller.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const SERVICE_TOKEN_VALUE = "grt_svc_public_api_caller_auth_token_01";

async function createServiceTokenDatabase(): Promise<SqliteD1Database> {
  const database = new SqliteD1Database();
  const tokenHash = await hashTokenValue(SERVICE_TOKEN_VALUE);

  database.execute(`
    CREATE TABLE organization_service_token (
      allow_attribution integer NOT NULL DEFAULT 0,
      created_at integer NOT NULL,
      created_by_account_id text NOT NULL,
      id text PRIMARY KEY NOT NULL,
      label text NOT NULL,
      last_used_at integer,
      organization_id text NOT NULL,
      revoked_at integer,
      token_hash text NOT NULL,
      updated_at integer NOT NULL
    );

    INSERT INTO organization_service_token (
      allow_attribution,
      created_at,
      created_by_account_id,
      id,
      label,
      last_used_at,
      organization_id,
      revoked_at,
      token_hash,
      updated_at
    )
    VALUES (
      1,
      1,
      '01J00000000000000000000001',
      'svc-1',
      'Automation',
      NULL,
      '01J00000000000000000000006',
      NULL,
      '${tokenHash}',
      1
    );
  `);

  return database;
}

describe("public API caller authentication", () => {
  test("routes service tokens as public API callers", async () => {
    const database = await createServiceTokenDatabase();

    const caller = await authenticatePublicApiCaller(database, SERVICE_TOKEN_VALUE);

    expect(caller).toMatchObject({
      allowAttribution: true,
      kind: "service_token",
      organizationId: "01J00000000000000000000006",
      tokenId: "svc-1",
      tokenLabel: "Automation",
    });
  });

  test("rejects non-service token values", async () => {
    const database = await createServiceTokenDatabase();

    const caller = await authenticateOrganizationServiceToken(database, "grt_pat_wrong_table");

    expect(caller).toBeNull();
  });

  test("rejects unknown token prefixes", async () => {
    const database = await createServiceTokenDatabase();

    const caller = await authenticatePublicApiCaller(database, "not_a_known_token");

    expect(caller).toBeNull();
  });
});
