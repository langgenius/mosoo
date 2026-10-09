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
  createPublicHttpContractDatabase,
  insertNonOwnerSession,
  insertSessionRunFixture,
} from "./helpers/public-api-http-test-fixture";

const STALE_RUN_ID = "01J0000000000000000000R001";

describe("session run reconciliation", () => {
  test("preserves a cold boot before a driver is attached", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    const sessionId = "01J0000000000000000000000B";
    const runId = "01J0000000000000000000000N";
    // The delayed staging continuation was reclaimed after 41 seconds of
    // booting, before preparation had attached any driver to the run.
    await insertSessionRunFixture(database, {
      createdAt: Date.now() - 41_000,
      id: runId,
      status: "booting",
    });

    expect(await reconcileStaleActiveSessionRun(database, sessionId)).toBe(false);
    expect(
      await database
        .prepare("SELECT status, driver_instance_id FROM session_run WHERE id = ?")
        .bind(runId)
        .first(),
    ).toEqual({ status: "booting", driver_instance_id: null });

    // An abandoned preparation still expires at the cold-ready deadline.
    await database
      .prepare("UPDATE session_run SET updated_at = ? WHERE id = ?")
      .bind(Date.now() - DRIVER_COLD_READY_TIMEOUT_MS - 1_000, runId)
      .run();
    expect(await reconcileStaleActiveSessionRun(database, sessionId)).toBe(true);
  });

  test("keeps connecting runs alive for the cold ready budget", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    const driverId = "01J0000000000000000000000E";
    const runId = "01J0000000000000000000000N";

    await database
      .prepare(
        `
          INSERT INTO driver_instance (
            id,
            sandbox_id,
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
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        driverId,
        "01J0000000000000000000000D",
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
    await insertSessionRunFixture(database, {
      driverInstanceId: driverId,
      id: runId,
      status: "running",
    });

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

    await insertSessionRunFixture(database, { id: STALE_RUN_ID, status: "running" });

    await expect(
      reconcileStaleActiveSessionRun(database, "01J0000000000000000000000B"),
    ).resolves.toBe(true);

    const run = await database
      .prepare("SELECT error_code, status FROM session_run WHERE id = ?")
      .bind(STALE_RUN_ID)
      .first<{ error_code: string | null; status: string }>();
    expect(run).toMatchObject({
      status: "failed",
    });
    expect(run?.error_code).toBeString();
  });

  test("reconciles stale active runs in batches", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);

    await insertSessionRunFixture(database, { id: STALE_RUN_ID, status: "running" });

    await expect(
      reconcileStaleActiveSessionRuns(database, {
        limit: 10,
      }),
    ).resolves.toEqual({
      reconciledRunIds: [STALE_RUN_ID],
      reconciledSessionIds: ["01J0000000000000000000000B"],
    });

    const run = await database
      .prepare("SELECT error_code, status FROM session_run WHERE id = ?")
      .bind(STALE_RUN_ID)
      .first<{ error_code: string | null; status: string }>();
    expect(run).toMatchObject({
      status: "failed",
    });
    expect(run?.error_code).toBeString();
  });
});
