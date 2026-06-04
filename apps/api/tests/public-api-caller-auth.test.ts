import { describe, expect, test } from "bun:test";

import { authenticatePublicApiCaller } from "../src/modules/auth/application/public-api-caller.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const SERVICE_TOKEN_VALUE = "grt_svc_public_api_caller_auth_token_01";

describe("public API caller authentication", () => {
  test("rejects service token values as public API callers", async () => {
    const database = new SqliteD1Database();

    const caller = await authenticatePublicApiCaller(database, SERVICE_TOKEN_VALUE);

    expect(caller).toBeNull();
  });

  test("rejects unknown token prefixes", async () => {
    const database = new SqliteD1Database();

    const caller = await authenticatePublicApiCaller(database, "not_a_known_token");

    expect(caller).toBeNull();
  });
});
