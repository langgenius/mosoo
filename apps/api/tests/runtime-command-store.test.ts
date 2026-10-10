import { describe, expect, test } from "bun:test";

import type { RuntimeCommand, RuntimeCommandStatus } from "@mosoo/contracts/runtime-command";
import { parsePlatformId } from "@mosoo/id";
import type { DriverCommandId, DriverInstanceId, SessionRunId } from "@mosoo/id";

import {
  claimNextQueuedRuntimeCommand,
  createRuntimeCommandRecord,
  expireUndeliveredInputStartCommandsForRun,
  updateRuntimeCommandRecord,
} from "../src/modules/runtime/infrastructure/session-runs/runtime-command-store.repository";
import { decideRuntimeCommandTransition } from "../src/modules/runtime/infrastructure/session-runs/runtime-command-transition";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const DRIVER_INSTANCE_ID = parsePlatformId<DriverInstanceId>("01J00000000000000000000009");
const SESSION_RUN_ID = parsePlatformId<SessionRunId>("01J0000000000000000000000N");
const COMMAND_IDS = {
  accepted: parsePlatformId<DriverCommandId>("01J00000000000000000000015"),
  current: parsePlatformId<DriverCommandId>("01J00000000000000000000017"),
  currentRunQueued: parsePlatformId<DriverCommandId>("01J00000000000000000000026"),
  expired: parsePlatformId<DriverCommandId>("01J00000000000000000000013"),
  first: parsePlatformId<DriverCommandId>("01J00000000000000000000011"),
  illegal: parsePlatformId<DriverCommandId>("01J00000000000000000000018"),
  second: parsePlatformId<DriverCommandId>("01J00000000000000000000012"),
  otherRunQueued: parsePlatformId<DriverCommandId>("01J00000000000000000000027"),
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
  queued: [],
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

async function readCommandStatus(
  database: SqliteD1Database,
  commandId: DriverCommandId,
): Promise<string | null> {
  const row = await database
    .prepare("SELECT status FROM driver_command WHERE id = ?")
    .bind(commandId)
    .first<{ status: string }>();

  return row?.status ?? null;
}

describe("runtime command store", () => {
  test("keeps runtime command transitions on the owner matrix", () => {
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

    const first = await claimNextQueuedRuntimeCommand(database, DRIVER_INSTANCE_ID, "connection-1");
    const second = await claimNextQueuedRuntimeCommand(
      database,
      DRIVER_INSTANCE_ID,
      "connection-1",
    );
    const empty = await claimNextQueuedRuntimeCommand(database, DRIVER_INSTANCE_ID, "connection-1");

    expect(first).toEqual(inputStartCommand(COMMAND_IDS.first));
    expect(second).toEqual(inputStartCommand(COMMAND_IDS.second));
    expect(empty).toBeNull();
    expect(await readCommandStatus(database, COMMAND_IDS.first)).toBe("delivered");
    expect(await readCommandStatus(database, COMMAND_IDS.second)).toBe("delivered");
  });

  test("does not deliver expired queued commands", async () => {
    const database = createRuntimeCommandDatabase();

    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.expired),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: Date.now() - 1_000,
    });

    const claimed = await claimNextQueuedRuntimeCommand(
      database,
      DRIVER_INSTANCE_ID,
      "connection-1",
    );

    expect(claimed).toBeNull();
    expect(await readCommandStatus(database, COMMAND_IDS.expired)).toBe("queued");
  });

  test("does not deliver commands to a connection that is no longer current", async () => {
    const database = createRuntimeCommandDatabase();

    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.current),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: Date.now() + 60_000,
    });

    await expect(
      claimNextQueuedRuntimeCommand(database, DRIVER_INSTANCE_ID, "connection-old"),
    ).resolves.toBeNull();
    expect(await readCommandStatus(database, COMMAND_IDS.current)).toBe("queued");
  });

  test("replayed accepted receipts are duplicates and never requeue execution", async () => {
    const database = createRuntimeCommandDatabase();
    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.accepted),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: Date.now() + 60_000,
    });
    await claimNextQueuedRuntimeCommand(database, DRIVER_INSTANCE_ID, "connection-1");
    const receipt = {
      commandId: COMMAND_IDS.accepted,
      connectionId: "connection-1",
      driverInstanceId: DRIVER_INSTANCE_ID,
      status: "accepted" as const,
    };
    expect(await updateRuntimeCommandRecord(database, receipt)).toEqual({
      kind: "applied",
      status: "accepted",
    });
    expect(await updateRuntimeCommandRecord(database, receipt)).toEqual({
      kind: "duplicate",
      status: "accepted",
    });
    expect(
      await claimNextQueuedRuntimeCommand(database, DRIVER_INSTANCE_ID, "connection-1"),
    ).toBeNull();
    expect(await readCommandStatus(database, COMMAND_IDS.accepted)).toBe("accepted");
  });

  test("expires undelivered input commands for one run", async () => {
    const database = createRuntimeCommandDatabase();
    const otherRunId = parsePlatformId<SessionRunId>("01J0000000000000000000000P");

    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.accepted),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: Date.now() + 60_000,
    });
    await claimNextQueuedRuntimeCommand(database, DRIVER_INSTANCE_ID, "connection-1");
    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.currentRunQueued),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: Date.now() + 60_000,
    });
    await createRuntimeCommandRecord(database, {
      command: {
        ...inputStartCommand(COMMAND_IDS.otherRunQueued),
        runId: otherRunId,
      },
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: Date.now() + 60_000,
    });
    await updateRuntimeCommandRecord(database, {
      commandId: COMMAND_IDS.accepted,
      connectionId: "connection-1",
      driverInstanceId: DRIVER_INSTANCE_ID,
      status: "accepted",
    });

    await expireUndeliveredInputStartCommandsForRun(database, {
      driverInstanceId: DRIVER_INSTANCE_ID,
      runId: SESSION_RUN_ID,
    });

    expect(await readCommandStatus(database, COMMAND_IDS.currentRunQueued)).toBe("expired");
    expect(await readCommandStatus(database, COMMAND_IDS.accepted)).toBe("accepted");
    expect(await readCommandStatus(database, COMMAND_IDS.otherRunQueued)).toBe("queued");
  });

  test("rejects illegal command status rewrites after terminal completion", async () => {
    const database = createRuntimeCommandDatabase();

    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.illegal),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: Date.now() + 60_000,
    });
    await claimNextQueuedRuntimeCommand(database, DRIVER_INSTANCE_ID, "connection-1");

    await expect(
      updateRuntimeCommandRecord(database, {
        commandId: COMMAND_IDS.illegal,
        connectionId: "connection-1",
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
        connectionId: "connection-1",
        driverInstanceId: DRIVER_INSTANCE_ID,
        status: "accepted",
      }),
    ).resolves.toMatchObject({
      currentStatus: "completed",
      kind: "rejected",
      reason: "illegal_transition",
      targetStatus: "accepted",
    });

    expect(await readCommandStatus(database, COMMAND_IDS.illegal)).toBe("completed");
  });

  test("persists terminal payloads, accepts identical replay, and rejects a changed result", async () => {
    const database = createRuntimeCommandDatabase();
    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.first),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: Date.now() + 60_000,
    });
    await claimNextQueuedRuntimeCommand(database, DRIVER_INSTANCE_ID, "connection-1");
    const receipt = {
      commandId: COMMAND_IDS.first,
      connectionId: "connection-1",
      driverInstanceId: DRIVER_INSTANCE_ID,
      result: { requestId: "request-1", outputText: "permission denied", isError: true },
      status: "completed" as const,
    };

    expect(await updateRuntimeCommandRecord(database, receipt)).toEqual({
      kind: "applied",
      status: "completed",
    });
    expect(
      await updateRuntimeCommandRecord(database, {
        ...receipt,
        result: { isError: true, outputText: "permission denied", requestId: "request-1" },
      }),
    ).toEqual({
      kind: "duplicate",
      status: "completed",
    });
    expect(
      await updateRuntimeCommandRecord(database, { ...receipt, result: { requestId: "changed" } }),
    ).toMatchObject({ kind: "rejected" });
    const row = await database
      .prepare("SELECT result_json, error_json, completed_at FROM driver_command WHERE id = ?")
      .bind(COMMAND_IDS.first)
      .first<{ result_json: string; error_json: null; completed_at: number }>();
    expect(JSON.parse(row!.result_json)).toEqual(receipt.result);
    expect(row!.error_json).toBeNull();
    expect(row!.completed_at).toBeGreaterThan(0);
  });

  test("fences command updates by the current connection and preserves the durable failure", async () => {
    const database = createRuntimeCommandDatabase();
    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.first),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: Date.now() + 60_000,
    });
    await claimNextQueuedRuntimeCommand(database, DRIVER_INSTANCE_ID, "connection-1");
    const receipt = {
      commandId: COMMAND_IDS.first,
      connectionId: "connection-old",
      driverInstanceId: DRIVER_INSTANCE_ID,
      error: {
        code: "driver.failed",
        details: { run: SESSION_RUN_ID, é: 1, "e\u0301": 2 },
        message: "Failed",
        retryable: false,
      },
      status: "failed" as const,
    };
    expect(await updateRuntimeCommandRecord(database, receipt)).toMatchObject({ kind: "rejected" });
    expect(await readCommandStatus(database, COMMAND_IDS.first)).toBe("delivered");
    expect(
      await updateRuntimeCommandRecord(database, { ...receipt, connectionId: "connection-1" }),
    ).toMatchObject({ kind: "applied" });
    expect(
      await updateRuntimeCommandRecord(database, {
        ...receipt,
        connectionId: "connection-1",
        error: { ...receipt.error, details: { "e\u0301": 2, é: 1, run: SESSION_RUN_ID } },
      }),
    ).toMatchObject({ kind: "duplicate" });
    const row = await database
      .prepare("SELECT error_json FROM driver_command WHERE id = ?")
      .bind(COMMAND_IDS.first)
      .first<{ error_json: string }>();
    expect(JSON.parse(row!.error_json)).toEqual(receipt.error);
  });
});
