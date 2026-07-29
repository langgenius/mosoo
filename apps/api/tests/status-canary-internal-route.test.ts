import { describe, expect, test } from "bun:test";

import { PUBLIC_API_PREFIX } from "@mosoo/contracts/public-api";

import { createHttpApp } from "../src/adapters/http/create-http-app";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const THREAD_ID = "01J00000000000000000000001";
const FIRST_RUN_ID = "01J00000000000000000000002";
const FOLLOW_UP_RUN_ID = "01J00000000000000000000003";
const DRIVER_ID = "01J00000000000000000000004";
const WRONG_THREAD_ID = "01J00000000000000000000005";
const SECRET = "test-status-canary-secret";

function createBindings(): ApiBindings {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE session_run (
      id text PRIMARY KEY NOT NULL,
      session_id text NOT NULL,
      driver_instance_id text
    );
    INSERT INTO session_run (id, session_id, driver_instance_id) VALUES
      ('${FIRST_RUN_ID}', '${THREAD_ID}', '${DRIVER_ID}'),
      ('${FOLLOW_UP_RUN_ID}', '${THREAD_ID}', '${DRIVER_ID}');
  `);

  return {
    DB: database,
    MOSOO_STATUS_CANARY_SECRET: SECRET,
  } as ApiBindings;
}

describe("status canary driver reuse route", () => {
  test("requires its shared secret and compares only runs from the requested thread", async () => {
    const bindings = createBindings();
    const url = `${PUBLIC_API_PREFIX}/v1/internal/status-canary/driver-reuse`;
    const body = JSON.stringify({
      runIds: [FIRST_RUN_ID, FOLLOW_UP_RUN_ID],
      threadId: THREAD_ID,
    });
    const unauthorized = await createHttpApp().request(
      url,
      { body, headers: { "content-type": "application/json" }, method: "POST" },
      bindings,
    );
    const authorized = await createHttpApp().request(
      url,
      {
        body,
        headers: {
          "content-type": "application/json",
          "x-status-canary-auth": SECRET,
        },
        method: "POST",
      },
      bindings,
    );
    const wrongThread = await createHttpApp().request(
      url,
      {
        body: JSON.stringify({
          runIds: [FIRST_RUN_ID, FOLLOW_UP_RUN_ID],
          threadId: WRONG_THREAD_ID,
        }),
        headers: {
          "content-type": "application/json",
          "x-status-canary-auth": SECRET,
        },
        method: "POST",
      },
      bindings,
    );

    expect(unauthorized.status).toBe(401);
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toEqual({ ok: true, sameDriver: true });
    expect(wrongThread.status).toBe(409);
  });
});
