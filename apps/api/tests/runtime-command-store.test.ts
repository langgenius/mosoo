import { describe, expect, test } from "bun:test";

import type { RuntimeCommand, RuntimeCommandStatus } from "@mosoo/contracts/runtime-command";
import { parsePlatformId } from "@mosoo/id";
import type { DriverCommandId, DriverInstanceId, SessionRunId } from "@mosoo/id";

import {
  claimNextQueuedRuntimeCommandRecord,
  createRuntimeCommandRecord,
  repairRuntimeCommandRecords,
  getRuntimeCommandRecord,
  markRuntimeCommandRecordDelivered,
  maintainRuntimeCommandRecords,
  updateRuntimeCommandRecord,
} from "../src/modules/runtime/infrastructure/session-runs/runtime-command-store.repository";
import {
  decideRuntimeCommandTransition,
  getRuntimeCommandDeliveryLeaseExpirableStatuses,
  getRuntimeCommandPreviousStatuses,
  isRuntimeCommandAcknowledgedStatus,
  isRuntimeCommandTerminalStatus,
} from "../src/modules/runtime/infrastructure/session-runs/runtime-command-transition";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const DRIVER_INSTANCE_ID = parsePlatformId<DriverInstanceId>("01J00000000000000000000009");
const TERMINAL_DRIVER_INSTANCE_ID = parsePlatformId<DriverInstanceId>("01J0000000000000000000000G");
const SESSION_RUN_ID = parsePlatformId<SessionRunId>("01J0000000000000000000000N");
const COMMAND_IDS = {
  accepted: parsePlatformId<DriverCommandId>("01J00000000000000000000015"),
  current: parsePlatformId<DriverCommandId>("01J00000000000000000000017"),
  delivered: parsePlatformId<DriverCommandId>("01J00000000000000000000014"),
  expired: parsePlatformId<DriverCommandId>("01J00000000000000000000013"),
  first: parsePlatformId<DriverCommandId>("01J00000000000000000000011"),
  globalAccepted: parsePlatformId<DriverCommandId>("01J00000000000000000000025"),
  globalExpired: parsePlatformId<DriverCommandId>("01J00000000000000000000023"),
  globalStale: parsePlatformId<DriverCommandId>("01J00000000000000000000024"),
  illegal: parsePlatformId<DriverCommandId>("01J00000000000000000000018"),
  maintenanceExpired: parsePlatformId<DriverCommandId>("01J00000000000000000000021"),
  maintenanceStale: parsePlatformId<DriverCommandId>("01J00000000000000000000022"),
  redelivery: parsePlatformId<DriverCommandId>("01J00000000000000000000020"),
  second: parsePlatformId<DriverCommandId>("01J00000000000000000000012"),
  stale: parsePlatformId<DriverCommandId>("01J00000000000000000000016"),
  staleUpdate: parsePlatformId<DriverCommandId>("01J00000000000000000000019"),
} as const;
const RUNTIME_COMMAND_STATUSES = [
  "queued",
  "delivered",
  "accepted",
  "completed",
  "failed",
  "expired",
  "cancelled",
] as const satisfies readonly RuntimeCommandStatus[];
const EXPECTED_PREVIOUS_STATUSES = {
  accepted: ["delivered"],
  cancelled: ["queued", "delivered", "accepted"],
  completed: ["delivered", "accepted"],
  delivered: ["queued"],
  expired: ["queued", "delivered", "accepted"],
  failed: ["delivered", "accepted"],
  queued: ["delivered"],
} as const satisfies Record<RuntimeCommandStatus, readonly RuntimeCommandStatus[]>;

function createRuntimeCommandDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE driver_instance (
      command_seq_cursor integer DEFAULT 0 NOT NULL,
      connection_id text,
      id text PRIMARY KEY NOT NULL,
      status text DEFAULT 'ready' NOT NULL
    );

    CREATE TABLE driver_command (
      acked_at integer,
      completed_at integer,
      delivery_connection_id text,
      driver_instance_id text NOT NULL,
      error_json text,
      expires_at integer,
      id text PRIMARY KEY NOT NULL,
      issued_at integer NOT NULL,
      kind text NOT NULL,
      payload_json text NOT NULL,
      result_json text,
      seq integer NOT NULL,
      status text NOT NULL
    );

    INSERT INTO driver_instance (id, connection_id, status)
    VALUES ('${DRIVER_INSTANCE_ID}', 'connection-1', 'ready');
  `);

  return database;
}

function inputStartCommand(id: DriverCommandId): RuntimeCommand {
  return {
    commandId: id,
    input: {
      text: `hello from ${id}`,
    },
    kind: "input.start",
    requestId: `request-${id}`,
    runId: SESSION_RUN_ID,
  };
}

describe("runtime command store", () => {
  test("keeps runtime command transitions on the owner matrix", () => {
    for (const targetStatus of RUNTIME_COMMAND_STATUSES) {
      expect(getRuntimeCommandPreviousStatuses(targetStatus)).toEqual(
        EXPECTED_PREVIOUS_STATUSES[targetStatus],
      );
    }

    for (const currentStatus of RUNTIME_COMMAND_STATUSES) {
      for (const targetStatus of RUNTIME_COMMAND_STATUSES) {
        const outcome = decideRuntimeCommandTransition(currentStatus, targetStatus);

        if (currentStatus === targetStatus) {
          expect(outcome).toEqual({
            kind: "duplicate",
            status: currentStatus,
          });
          continue;
        }

        const previousStatuses: readonly RuntimeCommandStatus[] =
          EXPECTED_PREVIOUS_STATUSES[targetStatus];

        if (previousStatuses.includes(currentStatus)) {
          expect(outcome).toEqual({
            kind: "applied",
            status: targetStatus,
          });
          continue;
        }

        expect(outcome).toEqual({
          currentStatus,
          kind: "rejected",
          reason: "illegal_transition",
          targetStatus,
        });
      }
    }
  });

  test("keeps runtime command ack and terminal status classifiers on the owner", () => {
    expect(getRuntimeCommandDeliveryLeaseExpirableStatuses()).toEqual(["queued", "delivered"]);
    expect(RUNTIME_COMMAND_STATUSES.filter(isRuntimeCommandAcknowledgedStatus)).toEqual([
      "accepted",
      "completed",
      "failed",
    ]);
    expect(RUNTIME_COMMAND_STATUSES.filter(isRuntimeCommandTerminalStatus)).toEqual([
      "completed",
      "failed",
      "expired",
      "cancelled",
    ]);
  });

  test("claims queued commands in sequence and marks them delivered", async () => {
    const database = createRuntimeCommandDatabase();
    const expiresAt = Date.now() + 60_000;

    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.first),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt,
    });
    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.second),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt,
    });

    const first = await claimNextQueuedRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      "connection-1",
    );
    const second = await claimNextQueuedRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      "connection-1",
    );
    const empty = await claimNextQueuedRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      "connection-1",
    );
    const storedFirst = await getRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      COMMAND_IDS.first,
    );

    expect(first?.id).toBe(COMMAND_IDS.first);
    expect(first?.status).toBe("delivered");
    expect(second?.id).toBe(COMMAND_IDS.second);
    expect(second?.status).toBe("delivered");
    expect(empty).toBeNull();
    expect(storedFirst?.status).toBe("delivered");
  });

  test("does not deliver expired queued commands", async () => {
    const database = createRuntimeCommandDatabase();

    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.expired),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: Date.now() - 1_000,
    });

    const claimed = await claimNextQueuedRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      "connection-1",
    );
    const stored = await getRuntimeCommandRecord(database, DRIVER_INSTANCE_ID, COMMAND_IDS.expired);

    expect(claimed).toBeNull();
    expect(stored?.status).toBe("expired");
    expect(stored?.error?.code).toBe("driver.command_delivery_expired");
  });

  test("expires delivered commands that were not accepted before the lease elapsed", async () => {
    const database = createRuntimeCommandDatabase();

    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.delivered),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: Date.now() + 60_000,
    });

    await claimNextQueuedRuntimeCommandRecord(database, DRIVER_INSTANCE_ID, "connection-1");
    database.execute(`
      UPDATE driver_command
      SET expires_at = ${Date.now() - 1_000}
      WHERE id = '${COMMAND_IDS.delivered}'
    `);

    const claimed = await claimNextQueuedRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      "connection-1",
    );
    const stored = await getRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      COMMAND_IDS.delivered,
    );

    expect(claimed).toBeNull();
    expect(stored?.status).toBe("expired");
    expect(stored?.ackedAt).toBeNull();
    expect(stored?.error?.code).toBe("driver.command_delivery_expired");
  });

  test("does not expire delivered commands after the driver accepts them", async () => {
    const database = createRuntimeCommandDatabase();

    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.accepted),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: Date.now() + 60_000,
    });

    await claimNextQueuedRuntimeCommandRecord(database, DRIVER_INSTANCE_ID, "connection-1");
    await updateRuntimeCommandRecord(database, {
      commandId: COMMAND_IDS.accepted,
      deliveryConnectionId: "connection-1",
      driverInstanceId: DRIVER_INSTANCE_ID,
      status: "accepted",
    });
    database.execute(`
      UPDATE driver_command
      SET expires_at = ${Date.now() - 1_000}
      WHERE id = '${COMMAND_IDS.accepted}'
    `);

    const claimed = await claimNextQueuedRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      "connection-1",
    );
    const stored = await getRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      COMMAND_IDS.accepted,
    );

    expect(claimed).toBeNull();
    expect(stored?.status).toBe("accepted");
    expect(stored?.ackedAt).not.toBeNull();
    expect(stored?.error).toBeNull();
  });

  test("recovers commands delivered to stale connections", async () => {
    const database = createRuntimeCommandDatabase();

    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.stale),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: Date.now() + 60_000,
    });

    await expect(
      markRuntimeCommandRecordDelivered(database, {
        commandId: COMMAND_IDS.stale,
        connectionId: "connection-1",
        driverInstanceId: DRIVER_INSTANCE_ID,
      }),
    ).resolves.toEqual({
      kind: "applied",
      status: "delivered",
    });
    database.execute(`
      UPDATE driver_instance
      SET connection_id = 'connection-2'
      WHERE id = '${DRIVER_INSTANCE_ID}'
    `);

    const claimed = await claimNextQueuedRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      "connection-2",
    );

    expect(claimed?.id).toBe(COMMAND_IDS.stale);
    expect(claimed?.status).toBe("delivered");
  });

  test("returns typed command maintenance batch outcomes", async () => {
    const database = createRuntimeCommandDatabase();
    const nowMs = Date.now();

    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.maintenanceExpired),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: nowMs - 1_000,
    });
    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.maintenanceStale),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: nowMs + 60_000,
    });
    await expect(
      markRuntimeCommandRecordDelivered(database, {
        commandId: COMMAND_IDS.maintenanceStale,
        connectionId: "connection-1",
        driverInstanceId: DRIVER_INSTANCE_ID,
      }),
    ).resolves.toEqual({
      kind: "applied",
      status: "delivered",
    });
    database.execute(`
      UPDATE driver_instance
      SET connection_id = 'connection-2'
      WHERE id = '${DRIVER_INSTANCE_ID}'
    `);

    await expect(
      maintainRuntimeCommandRecords(database, {
        connectionId: "connection-2",
        driverInstanceId: DRIVER_INSTANCE_ID,
        nowMs,
      }),
    ).resolves.toEqual({
      expired: {
        appliedCount: 1,
        kind: "batch_applied",
        status: "expired",
      },
      recovered: {
        appliedCount: 1,
        kind: "batch_applied",
        status: "queued",
      },
    });

    const expired = await getRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      COMMAND_IDS.maintenanceExpired,
    );
    const recovered = await getRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      COMMAND_IDS.maintenanceStale,
    );

    expect(expired?.status).toBe("expired");
    expect(recovered?.status).toBe("queued");
  });

  test("repairs queued, delivered, and accepted commands globally", async () => {
    const database = createRuntimeCommandDatabase();
    const nowMs = Date.now();

    database.execute(`
      INSERT INTO driver_instance (id, connection_id, status)
      VALUES ('${TERMINAL_DRIVER_INSTANCE_ID}', 'terminal-connection', 'stopped')
    `);
    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.globalExpired),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: nowMs - 1_000,
    });
    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.globalStale),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: nowMs + 60_000,
    });
    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.globalAccepted),
      driverInstanceId: TERMINAL_DRIVER_INSTANCE_ID,
      expiresAt: nowMs + 60_000,
    });
    await markRuntimeCommandRecordDelivered(database, {
      commandId: COMMAND_IDS.globalStale,
      connectionId: "connection-1",
      driverInstanceId: DRIVER_INSTANCE_ID,
    });
    await markRuntimeCommandRecordDelivered(database, {
      commandId: COMMAND_IDS.globalAccepted,
      connectionId: "terminal-connection",
      driverInstanceId: TERMINAL_DRIVER_INSTANCE_ID,
    });
    await updateRuntimeCommandRecord(database, {
      commandId: COMMAND_IDS.globalAccepted,
      deliveryConnectionId: "terminal-connection",
      driverInstanceId: TERMINAL_DRIVER_INSTANCE_ID,
      status: "accepted",
    });
    database.execute(`
      UPDATE driver_instance
      SET connection_id = 'connection-2'
      WHERE id = '${DRIVER_INSTANCE_ID}'
    `);

    await expect(repairRuntimeCommandRecords(database, { nowMs })).resolves.toEqual({
      expired: {
        appliedCount: 1,
        kind: "batch_applied",
        status: "expired",
      },
      failed: {
        appliedCount: 1,
        kind: "batch_applied",
        status: "failed",
      },
      recovered: {
        appliedCount: 1,
        kind: "batch_applied",
        status: "queued",
      },
    });

    const expired = await getRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      COMMAND_IDS.globalExpired,
    );
    const recovered = await getRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      COMMAND_IDS.globalStale,
    );
    const failed = await getRuntimeCommandRecord(
      database,
      TERMINAL_DRIVER_INSTANCE_ID,
      COMMAND_IDS.globalAccepted,
    );

    expect(expired?.status).toBe("expired");
    expect(recovered?.status).toBe("queued");
    expect(failed?.status).toBe("failed");
    expect(failed?.error?.code).toBe("driver.command_driver_terminal");
  });

  test("does not mark commands delivered for stale connections", async () => {
    const database = createRuntimeCommandDatabase();

    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.current),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: Date.now() + 60_000,
    });

    await expect(
      markRuntimeCommandRecordDelivered(database, {
        commandId: COMMAND_IDS.current,
        connectionId: "connection-old",
        driverInstanceId: DRIVER_INSTANCE_ID,
      }),
    ).resolves.toEqual({
      currentStatus: "queued",
      kind: "rejected",
      reason: "inactive_delivery_connection",
      targetStatus: "delivered",
    });

    const stored = await getRuntimeCommandRecord(database, DRIVER_INSTANCE_ID, COMMAND_IDS.current);

    expect(stored?.status).toBe("queued");
  });

  test("rejects delivered command claims from a different active connection", async () => {
    const database = createRuntimeCommandDatabase();

    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.redelivery),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: Date.now() + 60_000,
    });
    await expect(
      markRuntimeCommandRecordDelivered(database, {
        commandId: COMMAND_IDS.redelivery,
        connectionId: "connection-1",
        driverInstanceId: DRIVER_INSTANCE_ID,
      }),
    ).resolves.toEqual({
      kind: "applied",
      status: "delivered",
    });
    database.execute(`
      UPDATE driver_instance
      SET connection_id = 'connection-2'
      WHERE id = '${DRIVER_INSTANCE_ID}'
    `);

    await expect(
      markRuntimeCommandRecordDelivered(database, {
        commandId: COMMAND_IDS.redelivery,
        connectionId: "connection-2",
        driverInstanceId: DRIVER_INSTANCE_ID,
      }),
    ).resolves.toEqual({
      currentStatus: "delivered",
      kind: "rejected",
      reason: "stale_delivery_connection",
      targetStatus: "delivered",
    });
  });

  test("rejects illegal command status rewrites after terminal completion", async () => {
    const database = createRuntimeCommandDatabase();

    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.illegal),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: Date.now() + 60_000,
    });
    await claimNextQueuedRuntimeCommandRecord(database, DRIVER_INSTANCE_ID, "connection-1");

    await expect(
      updateRuntimeCommandRecord(database, {
        commandId: COMMAND_IDS.illegal,
        deliveryConnectionId: "connection-1",
        driverInstanceId: DRIVER_INSTANCE_ID,
        status: "completed",
      }),
    ).resolves.toEqual({
      kind: "applied",
      status: "completed",
    });

    await expect(
      updateRuntimeCommandRecord(database, {
        commandId: COMMAND_IDS.illegal,
        deliveryConnectionId: "connection-1",
        driverInstanceId: DRIVER_INSTANCE_ID,
        status: "accepted",
      }),
    ).resolves.toMatchObject({
      currentStatus: "completed",
      kind: "rejected",
      reason: "illegal_transition",
      targetStatus: "accepted",
    });

    const stored = await getRuntimeCommandRecord(database, DRIVER_INSTANCE_ID, COMMAND_IDS.illegal);

    expect(stored?.status).toBe("completed");
  });

  test("rejects command updates from stale delivery connections", async () => {
    const database = createRuntimeCommandDatabase();

    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.staleUpdate),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: Date.now() + 60_000,
    });
    await claimNextQueuedRuntimeCommandRecord(database, DRIVER_INSTANCE_ID, "connection-1");

    await expect(
      updateRuntimeCommandRecord(database, {
        commandId: COMMAND_IDS.staleUpdate,
        deliveryConnectionId: "connection-2",
        driverInstanceId: DRIVER_INSTANCE_ID,
        status: "accepted",
      }),
    ).resolves.toMatchObject({
      currentStatus: "delivered",
      kind: "rejected",
      reason: "stale_delivery_connection",
      targetStatus: "accepted",
    });

    const stored = await getRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      COMMAND_IDS.staleUpdate,
    );

    expect(stored?.status).toBe("delivered");
    expect(stored?.ackedAt).toBeNull();
  });
});
