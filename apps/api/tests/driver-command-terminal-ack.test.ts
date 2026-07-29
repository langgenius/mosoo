import { describe, expect, test } from "bun:test";

import type { DriverCommandId, DriverInstanceId, SessionRunId } from "@mosoo/id";
import { parsePlatformId } from "@mosoo/id";

import { DriverInstanceRpcCommandController } from "../src/modules/runtime/infrastructure/driver-instance/rpc-command-controller";
import { getRuntimeCommandRecord } from "../src/modules/runtime/infrastructure/session-runs/runtime-command-store.repository";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const DRIVER_INSTANCE_ID = parsePlatformId<DriverInstanceId>("01J00000000000000000000001");
const COMMAND_ID = parsePlatformId<DriverCommandId>("01J00000000000000000000002");
const SESSION_RUN_ID = parsePlatformId<SessionRunId>("01J00000000000000000000003");

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function createDeferred(): Deferred {
  let resolve = () => {};
  const promise = new Promise<void>((next) => {
    resolve = next;
  });

  return { promise, resolve };
}

type RawOptions = { columnNames?: boolean } | undefined;

function gateStatement(statement: D1PreparedStatement, started: Deferred, gate: Deferred) {
  const waitForGate = async () => {
    started.resolve();
    await gate.promise;
  };

  return {
    all: async <T = unknown>() => {
      await waitForGate();
      return statement.all<T>();
    },
    bind: (...values: unknown[]) => gateStatement(statement.bind(...values), started, gate),
    first: async <T = unknown>(column?: string) => {
      await waitForGate();
      return statement.first<T>(column);
    },
    raw: async <T = unknown[]>(options?: RawOptions) => {
      await waitForGate();
      return statement.raw<T>(options);
    },
    run: async <T = unknown>() => {
      await waitForGate();
      return statement.run<T>();
    },
  } satisfies D1PreparedStatement;
}

class GatedTerminalLookupDatabase extends SqliteD1Database {
  readonly cleanupGate = createDeferred();
  readonly cleanupStarted = createDeferred();

  override prepare(query: string): D1PreparedStatement {
    const statement = super.prepare(query);

    return query.includes('"session_run"')
      ? gateStatement(statement, this.cleanupStarted, this.cleanupGate)
      : statement;
  }
}

function createDatabase(): GatedTerminalLookupDatabase {
  const database = new GatedTerminalLookupDatabase({ foreignKeys: false });
  const payload = JSON.stringify({
    commandId: COMMAND_ID,
    input: { text: "hello" },
    kind: "input.start",
    requestId: "request-1",
    runId: SESSION_RUN_ID,
  });

  database.execute(`
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

    CREATE TABLE session_run (
      driver_instance_id text,
      id text PRIMARY KEY NOT NULL,
      status text NOT NULL
    );

    INSERT INTO driver_command (
      delivery_connection_id,
      driver_instance_id,
      id,
      issued_at,
      kind,
      payload_json,
      seq,
      status
    ) VALUES (
      'connection-1',
      '${DRIVER_INSTANCE_ID}',
      '${COMMAND_ID}',
      0,
      'input.start',
      '${payload}',
      1,
      'delivered'
    );
  `);

  return database;
}

describe("terminal runtime command acknowledgement", () => {
  test("returns before linked run cleanup finishes", async () => {
    const database = createDatabase();
    const backgroundTasks: Promise<unknown>[] = [];
    const controller = new DriverInstanceRpcCommandController({
      env: { DB: database } as ApiBindings,
      state: {
        requireDriverInstanceId: () => DRIVER_INSTANCE_ID,
      },
      waitUntil: (task: Promise<unknown>) => {
        backgroundTasks.push(task);
      },
      withRuntimeLogContext: (fn: () => unknown) => fn(),
    } as never);

    const update = controller.handleCommandUpdate(
      {
        commandId: COMMAND_ID,
        driverInstanceId: DRIVER_INSTANCE_ID,
        status: "completed",
      },
      {
        assertActiveConnection: () => undefined,
        connectionId: "connection-1",
      },
    );

    await database.cleanupStarted.promise;
    const acknowledgedBeforeCleanup = await Promise.race([
      update.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 20)),
    ]);

    expect(backgroundTasks).toHaveLength(1);
    database.cleanupGate.resolve();
    const result = await update;
    await Promise.all(backgroundTasks);

    expect(acknowledgedBeforeCleanup).toBeTrue();
    expect(result).toEqual({ ok: true });
    await expect(
      getRuntimeCommandRecord(database, DRIVER_INSTANCE_ID, COMMAND_ID),
    ).resolves.toMatchObject({ status: "completed" });
  });
});
