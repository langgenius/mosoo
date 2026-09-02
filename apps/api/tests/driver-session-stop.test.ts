import { describe, expect, test } from "bun:test";

import type { DriverInstanceId, SessionRunId } from "@mosoo/id";

import {
  repairClaimedDriverStopsGlobally,
  stopDriverSession,
} from "../src/modules/runtime/infrastructure/driver-session-stop.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

function createDriverStopDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE driver_instance (
      id text PRIMARY KEY NOT NULL,
      generation integer NOT NULL,
      sandbox_id text NOT NULL,
      sandbox_session_id text NOT NULL,
      status text NOT NULL,
      status_changed_at integer DEFAULT 0 NOT NULL,
      status_event text DEFAULT 'driver.provision' NOT NULL,
      status_operation_id text,
      status_seq integer DEFAULT 0 NOT NULL,
      status_source text DEFAULT 'system' NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE session_run (
      driver_instance_id text,
      id text PRIMARY KEY NOT NULL,
      session_id text NOT NULL,
      agent_id text NOT NULL,
      created_at integer NOT NULL,
      created_by_account_id text NOT NULL,
      deployment_version_id text,
      deployment_version_number integer,
      status text NOT NULL,
      model text,
      provider text,
      trace_id text NOT NULL,
      trigger text NOT NULL,
      error_code text,
      error_message text,
      error_details_json text,
      started_at integer,
      completed_at integer,
      status_changed_at integer DEFAULT 0 NOT NULL,
      status_event text DEFAULT 'run.queue' NOT NULL,
      status_operation_id text,
      status_seq integer DEFAULT 0 NOT NULL,
      status_source text DEFAULT 'system' NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE session (
      id text PRIMARY KEY NOT NULL,
      kind text DEFAULT 'pet' NOT NULL,
      last_run_id text,
      runtime_id text DEFAULT 'openai-runtime' NOT NULL,
      status text NOT NULL,
      status_operation_id text,
      status_seq integer DEFAULT 0 NOT NULL,
      type text DEFAULT 'ui' NOT NULL,
      updated_at integer NOT NULL,
      workspace_checkpoint_required integer DEFAULT 0 NOT NULL
    );

    CREATE TABLE sandbox (
      id text PRIMARY KEY NOT NULL,
      kind text NOT NULL,
      inactive_deadline_at integer,
      updated_at integer NOT NULL
    );

    CREATE TABLE sandbox_session (
      session_id text PRIMARY KEY NOT NULL,
      sandbox_id text NOT NULL,
      status text NOT NULL
    );

    INSERT INTO sandbox (id, kind, inactive_deadline_at, updated_at)
    VALUES ('01J0000000000000000000000D', 'pet', NULL, 1);

    INSERT INTO session (id, last_run_id, status, updated_at)
    VALUES ('session-1', 'run-1', 'RUNNING', 1);

    INSERT INTO session_run (
      id,
      driver_instance_id,
      session_id,
      agent_id,
      created_at,
      created_by_account_id,
      deployment_version_id,
      deployment_version_number,
      status,
      model,
      provider,
      trace_id,
      trigger,
      error_code,
      error_message,
      error_details_json,
      started_at,
      completed_at,
      updated_at
    )
    VALUES (
      'run-1',
      'driver-1',
      'session-1',
      '01J00000000000000000000009',
      1,
      'account-1',
      NULL,
      NULL,
      'running',
      NULL,
      NULL,
      'trace-1',
      'user_prompt',
      NULL,
      NULL,
      NULL,
      1,
      NULL,
      1
    );

    INSERT INTO driver_instance (
      id,
      generation,
      sandbox_id,
      sandbox_session_id,
      status,
      updated_at
    )
    VALUES ('driver-1', 0, '01J0000000000000000000000D', 'sandbox-session-1', 'failed', 1);
  `);

  return database;
}

describe("driver session stop", () => {
  test("releases the linked lease without competing with Driver terminal events", async () => {
    const database = createDriverStopDatabase();

    await stopDriverSession({ DB: database } as ApiBindings, {
      driverInstanceId: "driver-1",
      reason: "test.stop",
    });

    const run = await database
      .prepare("SELECT error_code, status FROM session_run WHERE id = ?")
      .bind("run-1")
      .first<{ error_code: string | null; status: string }>();
    expect(run).toEqual({
      error_code: null,
      status: "running",
    });

    const session = await database
      .prepare("SELECT status FROM session WHERE id = ?")
      .bind("session-1")
      .first<{ status: string }>();
    expect(session).toEqual({ status: "RUNNING" });

    const runLink = await database
      .prepare("SELECT driver_instance_id FROM session_run WHERE id = ?")
      .bind("run-1")
      .first<{ driver_instance_id: string | null }>();
    expect(runLink).toEqual({ driver_instance_id: null });
  });

  for (const preclaimed of [false, true]) {
    test(`claims the exact Driver and Run before sending the unscoped stop command${
      preclaimed ? " from its terminal owner" : ""
    }`, async () => {
      const database = createDriverStopDatabase();
      database.execute(`
      UPDATE driver_instance
      SET status = 'ready', status_operation_id = ${preclaimed ? "'run-1'" : "NULL"}
      WHERE id = 'driver-1'
    `);
      const observedClaims: unknown[] = [];
      const bindings = {
        DB: database,
        DriverConnection: {
          get: () => ({
            fetch: async (request: Request) => {
              const path = new URL(request.url).pathname;
              if (path === "/control/send") {
                observedClaims.push(
                  await database
                    .prepare(
                      "SELECT status, status_operation_id FROM driver_instance WHERE id = 'driver-1'",
                    )
                    .first(),
                );
                return Response.json({ ok: true });
              }
              if (path === "/wait/close") {
                database.execute(
                  "UPDATE driver_instance SET status = 'stopped' WHERE id = 'driver-1'",
                );
                return Response.json({ close: null, terminalized: true });
              }
              throw new Error(`Unexpected Driver control request: ${path}`);
            },
          }),
          idFromName: () => "driver-do-id",
        },
      } as unknown as ApiBindings;

      await stopDriverSession(bindings, {
        driverInstanceId: "driver-1" as DriverInstanceId,
        expectedDriverGeneration: 0,
        expectedSessionRunId: "run-1" as SessionRunId,
        reason: "test.claimed-stop",
      });

      expect(observedClaims).toEqual([
        {
          status: "stopping",
          status_operation_id: expect.any(String),
        },
      ]);
      await expect(
        database
          .prepare("SELECT status, status_operation_id FROM driver_instance WHERE id = 'driver-1'")
          .first(),
      ).resolves.toEqual({ status: "stopped", status_operation_id: null });
      await expect(
        database.prepare("SELECT driver_instance_id FROM session_run WHERE id = 'run-1'").first(),
      ).resolves.toEqual({ driver_instance_id: null });
    });
  }

  test("does not send a stale stop after a successor Run wins on the same Driver generation", async () => {
    const database = createDriverStopDatabase();
    database.execute("UPDATE driver_instance SET status = 'ready' WHERE id = 'driver-1'");
    const originalPrepare = database.prepare.bind(database);
    let injectSuccessor = true;
    database.prepare = ((query: string) => {
      const wrap = (statement: D1PreparedStatement): D1PreparedStatement =>
        new Proxy(statement, {
          get(target, property, receiver) {
            if (property === "bind") {
              return (...values: unknown[]) => wrap(target.bind(...values));
            }
            if (
              property === "all" ||
              property === "first" ||
              property === "raw" ||
              property === "run"
            ) {
              return async (...args: unknown[]) => {
                if (injectSuccessor) {
                  injectSuccessor = false;
                  database.execute(`
                    UPDATE session_run SET status = 'completed' WHERE id = 'run-1';
                    INSERT INTO session_run (
                      id, driver_instance_id, session_id, agent_id, created_at,
                      created_by_account_id, status, trace_id, trigger, updated_at
                    ) VALUES (
                      'run-2', 'driver-1', 'session-1', '01J00000000000000000000009', 2,
                      'account-1', 'running', 'trace-2', 'resume', 2
                    );
                    UPDATE session SET last_run_id = 'run-2', updated_at = 2 WHERE id = 'session-1';
                  `);
                }
                return Reflect.apply(target[property], target, args);
              };
            }
            return Reflect.get(target, property, receiver);
          },
        });

      return /update\s+(?:"|`)?driver_instance(?:"|`)?/i.test(query)
        ? wrap(originalPrepare(query))
        : originalPrepare(query);
    }) as typeof database.prepare;
    let controlRequests = 0;
    const bindings = {
      DB: database,
      DriverConnection: {
        get: () => ({
          fetch: async () => {
            controlRequests += 1;
            return Response.json({ ok: true });
          },
        }),
        idFromName: () => "driver-do-id",
      },
    } as unknown as ApiBindings;

    await expect(
      stopDriverSession(bindings, {
        driverInstanceId: "driver-1" as DriverInstanceId,
        expectedDriverGeneration: 0,
        expectedSessionRunId: "run-1" as SessionRunId,
        reason: "test.stale-stop",
      }),
    ).rejects.toThrow("exact Driver and Session Run ownership");

    expect(controlRequests).toBe(0);
    await expect(
      database
        .prepare("SELECT status, status_operation_id FROM driver_instance WHERE id = 'driver-1'")
        .first(),
    ).resolves.toEqual({ status: "ready", status_operation_id: null });
    await expect(
      database
        .prepare("SELECT driver_instance_id, status FROM session_run WHERE id = 'run-2'")
        .first(),
    ).resolves.toEqual({ driver_instance_id: "driver-1", status: "running" });
  });

  test("maintenance resumes a stop that crashed after its durable claim", async () => {
    const database = createDriverStopDatabase();
    const operationId = "01J0000000000000000000000X";
    database.execute(`
      UPDATE driver_instance
      SET status = 'stopping', status_operation_id = '${operationId}'
      WHERE id = 'driver-1'
    `);
    const requests: string[] = [];
    const bindings = {
      DB: database,
      DriverConnection: {
        get: () => ({
          fetch: async (request: Request) => {
            const path = new URL(request.url).pathname;
            requests.push(path);
            if (path === "/control/fail") {
              database.execute(
                "UPDATE driver_instance SET status = 'failed' WHERE id = 'driver-1'",
              );
            }
            return Response.json({ ok: true });
          },
        }),
        idFromName: () => "driver-do-id",
      },
    } as unknown as ApiBindings;

    await repairClaimedDriverStopsGlobally(bindings);

    expect(requests).toEqual(["/control/fail", "/wait/close"]);
    await expect(
      database
        .prepare("SELECT status_operation_id FROM driver_instance WHERE id = 'driver-1'")
        .first(),
    ).resolves.toEqual({ status_operation_id: null });
    await expect(
      database.prepare("SELECT driver_instance_id FROM session_run WHERE id = 'run-1'").first(),
    ).resolves.toEqual({ driver_instance_id: null });
  });
});
