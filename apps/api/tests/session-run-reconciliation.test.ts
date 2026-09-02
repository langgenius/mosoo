import { describe, expect, test } from "bun:test";

import {
  reconcileStaleActiveSessionRun,
  reconcileStaleActiveSessionRuns,
} from "../src/modules/runtime/application/session-runs/stale-run-reconciliation.service";
import {
  DRIVER_COLD_READY_TIMEOUT_MS,
  RUNTIME_SOCKET_TIMEOUT_MS,
} from "../src/modules/runtime/domain/runtime-config";
import {
  PUBLIC_API_TEST_IDS,
  createPublicHttpContractDatabase,
  insertActiveSandboxSessionFixture,
  insertNonOwnerSession,
} from "./helpers/public-api-http-test-fixture";

describe("session run reconciliation", () => {
  test("keeps connecting runs alive for the cold ready budget", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertActiveSandboxSessionFixture(database, {
      ownerAccountId: PUBLIC_API_TEST_IDS.nonOwnerAccount,
      sandboxId: PUBLIC_API_TEST_IDS.sandbox,
      sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
    });
    const driverId = "01J0000000000000000000000E";
    const runId = "01J0000000000000000000000N";

    await database
      .prepare(
        `
          INSERT INTO driver_instance (
            id,
            sandbox_id,
            sandbox_incarnation,
            sandbox_session_id,
            runtime,
            protocol,
            protocol_version,
            status,
            boot_token_hash,
            boot_token_expires_at,
            generation,
            heartbeat_count,
            expires_at,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        driverId,
        "01J0000000000000000000000D",
        1,
        "01J0000000000000000000000B",
        "cloudflare-container",
        "driver-ws",
        1,
        "connecting",
        new Uint8Array([1]),
        Date.now() + 10_000,
        0,
        0,
        Date.now() + 20_000,
        1,
        Date.now() - RUNTIME_SOCKET_TIMEOUT_MS - 1_000,
      )
      .run();
    await database
      .prepare(
        `
          INSERT INTO session_run (
            id,
            session_id,
            agent_id,
            created_by_account_id,
            trigger,
            status,
            provider,
            model,
            runtime_id,
            trace_id,
            driver_instance_id,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        runId,
        "01J0000000000000000000000B",
        "01J00000000000000000000009",
        "01J00000000000000000000002",
        "user_prompt",
        "running",
        "openai",
        "gpt-5.4",
        "openai-runtime",
        "trace-connecting",
        driverId,
        1,
        1,
      )
      .run();
    await database
      .prepare("UPDATE session SET last_run_id = ?, status = ? WHERE id = ?")
      .bind(runId, "RUNNING", "01J0000000000000000000000B")
      .run();

    await expect(
      reconcileStaleActiveSessionRun(database, "01J0000000000000000000000B"),
    ).resolves.toBe(false);

    await database
      .prepare("UPDATE driver_instance SET updated_at = ? WHERE id = ?")
      .bind(Date.now() - DRIVER_COLD_READY_TIMEOUT_MS - 1_000, driverId)
      .run();

    await expect(
      reconcileStaleActiveSessionRun(database, "01J0000000000000000000000B"),
    ).resolves.toBe(true);
  });

  test("fails stale active runs", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);

    await database
      .prepare(
        `
          INSERT INTO session_run (
            id,
            session_id,
            agent_id,
            created_by_account_id,
            trigger,
            status,
            provider,
            model,
            runtime_id,
            trace_id,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        PUBLIC_API_TEST_IDS.run,
        "01J0000000000000000000000B",
        "01J00000000000000000000009",
        "01J00000000000000000000002",
        "user_prompt",
        "running",
        "openai",
        "gpt-5.4",
        "openai-runtime",
        "trace-stale",
        1,
        1,
      )
      .run();
    await database
      .prepare("UPDATE session SET last_run_id = ?, status = ? WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.run, "RUNNING", "01J0000000000000000000000B")
      .run();

    await expect(
      reconcileStaleActiveSessionRun(database, "01J0000000000000000000000B"),
    ).resolves.toBe(true);

    const run = await database
      .prepare("SELECT error_code, status FROM session_run WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.run)
      .first<{ error_code: string | null; status: string }>();
    expect(run).toMatchObject({
      status: "failed",
    });
    expect(run?.error_code).toBeString();
  });

  test("does not fail a stale candidate after its Driver heartbeat recovers", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertActiveSandboxSessionFixture(database, {
      ownerAccountId: PUBLIC_API_TEST_IDS.nonOwnerAccount,
      sandboxId: PUBLIC_API_TEST_IDS.sandbox,
      sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
    });
    const driverId = "01J0000000000000000000000E";
    const runId = PUBLIC_API_TEST_IDS.run;
    const staleAt = Date.now() - RUNTIME_SOCKET_TIMEOUT_MS - 1_000;

    await database
      .prepare(
        `INSERT INTO driver_instance (
           id, sandbox_id, sandbox_incarnation, sandbox_session_id, runtime, protocol, protocol_version, status,
           boot_token_hash, boot_token_expires_at, generation, heartbeat_count,
           last_heartbeat_at, expires_at, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        driverId,
        "01J0000000000000000000000D",
        1,
        "01J0000000000000000000000B",
        "cloudflare-container",
        "driver-ws",
        1,
        "ready",
        new Uint8Array([1]),
        Date.now() + 10_000,
        0,
        1,
        staleAt,
        Date.now() + 20_000,
        1,
        staleAt,
      )
      .run();
    await database
      .prepare(
        `INSERT INTO session_run (
           id, session_id, agent_id, created_by_account_id, trigger, status, provider, model,
           runtime_id, trace_id, driver_instance_id, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        runId,
        "01J0000000000000000000000B",
        "01J00000000000000000000009",
        "01J00000000000000000000002",
        "user_prompt",
        "running",
        "openai",
        "gpt-5.4",
        "openai-runtime",
        "trace-heartbeat-race",
        driverId,
        1,
        1,
      )
      .run();
    await database
      .prepare("UPDATE session SET last_run_id = ?, status = ? WHERE id = ?")
      .bind(runId, "RUNNING", "01J0000000000000000000000B")
      .run();

    let raced = false;
    const racingDatabase = new Proxy(database, {
      get(target, property) {
        if (property === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            if (!raced) {
              raced = true;
              const recoveredAt = Date.now();
              await target
                .prepare(
                  "UPDATE driver_instance SET heartbeat_count = heartbeat_count + 1, last_heartbeat_at = ?, updated_at = ? WHERE id = ?",
                )
                .bind(recoveredAt, recoveredAt, driverId)
                .run();
            }
            return target.batch(statements);
          };
        }

        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as D1Database;

    await expect(
      reconcileStaleActiveSessionRun(racingDatabase, "01J0000000000000000000000B"),
    ).resolves.toBe(false);
    expect(raced).toBe(true);
    await expect(
      database.prepare("SELECT status FROM session_run WHERE id = ?").bind(runId).first(),
    ).resolves.toEqual({ status: "running" });
  });

  test("reconciles stale active runs in batches", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);

    await database
      .prepare(
        `
          INSERT INTO session_run (
            id,
            session_id,
            agent_id,
            created_by_account_id,
            trigger,
            status,
            provider,
            model,
            runtime_id,
            trace_id,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        PUBLIC_API_TEST_IDS.run,
        "01J0000000000000000000000B",
        "01J00000000000000000000009",
        "01J00000000000000000000002",
        "user_prompt",
        "running",
        "openai",
        "gpt-5.4",
        "openai-runtime",
        "trace-stale",
        1,
        1,
      )
      .run();
    await database
      .prepare("UPDATE session SET last_run_id = ?, status = ? WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.run, "RUNNING", "01J0000000000000000000000B")
      .run();

    await expect(
      reconcileStaleActiveSessionRuns(database, {
        limit: 10,
      }),
    ).resolves.toEqual({
      reconciledRunIds: [PUBLIC_API_TEST_IDS.run],
      reconciledSessionIds: ["01J0000000000000000000000B"],
    });

    const run = await database
      .prepare("SELECT error_code, status FROM session_run WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.run)
      .first<{ error_code: string | null; status: string }>();
    expect(run).toMatchObject({
      status: "failed",
    });
    expect(run?.error_code).toBeString();
  });
});
