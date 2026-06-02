import { describe, expect, mock, test } from "bun:test";

import { createOpaqueBootToken } from "../src/modules/runtime/infrastructure/runtime-boot-token";
import type { SandboxHandle } from "../src/modules/runtime/infrastructure/sandbox-handles";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

let currentSandbox: SandboxHandle | null = null;

mock.module("@cloudflare/sandbox", () => ({
  getSandbox: () => {
    if (currentSandbox === null) {
      throw new Error("Sandbox test handle was not configured.");
    }

    return currentSandbox;
  },
}));

const { connectDriverInstanceSandboxSocket } =
  await import("../src/modules/runtime/infrastructure/driver-instance/sandbox-socket-connection");

function createDriverInstanceDatabase(bootTokenHash: Uint8Array): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });
  const now = Date.now();

  database.execute(`
    CREATE TABLE driver_instance (
      boot_token_expires_at integer NOT NULL,
      boot_token_hash blob NOT NULL,
      boot_token_used_at integer,
      id text PRIMARY KEY NOT NULL,
      status text NOT NULL,
      status_changed_at integer NOT NULL,
      status_event text NOT NULL,
      status_seq integer NOT NULL,
      status_source text NOT NULL,
      updated_at integer NOT NULL
    );
  `);

  database
    .prepare(
      `
        INSERT INTO driver_instance (
          boot_token_expires_at,
          boot_token_hash,
          boot_token_used_at,
          id,
          status,
          status_changed_at,
          status_event,
          status_seq,
          status_source,
          updated_at
        )
        VALUES (?, ?, NULL, 'driver-1', 'provisioning', ?, 'driver.provision', 0, 'system', ?)
      `,
    )
    .bind(now + 60_000, bootTokenHash, now, now)
    .run();

  return database;
}

function createApiBindings(database: D1Database): ApiBindings {
  return {
    DB: database,
    Sandbox: {},
  } as unknown as ApiBindings;
}

function createSandboxHandle(input: { wsConnect: SandboxHandle["wsConnect"] }): SandboxHandle {
  const unavailable = async () => {
    throw new Error("Unexpected sandbox test method call.");
  };

  return {
    createBackup: unavailable,
    createSession: unavailable,
    deleteSession: unavailable,
    destroy: unavailable,
    exec: unavailable,
    getSession: unavailable,
    mkdir: unavailable,
    mountBucket: unavailable,
    readFile: unavailable,
    restoreBackup: unavailable,
    setKeepAlive: unavailable,
    startProcess: unavailable,
    terminal: unavailable,
    watch: unavailable,
    writeFile: unavailable,
    wsConnect: input.wsConnect,
  } as SandboxHandle;
}

describe("driver instance sandbox socket connection", () => {
  test("connects the sandbox driver control socket once the port is ready", async () => {
    const bootToken = await createOpaqueBootToken();
    const database = createDriverInstanceDatabase(bootToken.hash);
    const socket = { close() {} } as WebSocket;

    currentSandbox = createSandboxHandle({
      async wsConnect() {
        return { status: 101, webSocket: socket } as Response;
      },
    });

    const accepted: Array<{ socket: WebSocket; traceparent: string | null }> = [];

    await connectDriverInstanceSandboxSocket(
      {
        bootToken: bootToken.encoded,
        port: 50_665,
        sandboxId: "01J0000000000000000000000D",
        traceparent: "traceparent-1",
      },
      {
        acceptDriverSocket: async (acceptedSocket, traceparent) => {
          accepted.push({ socket: acceptedSocket, traceparent });
        },
        env: createApiBindings(database),
        requireDriverInstanceId: () => "driver-1",
      },
    );

    expect(accepted).toEqual([{ socket, traceparent: "traceparent-1" }]);
  });

  test("fails fast when the sandbox driver control socket is rejected", async () => {
    const bootToken = await createOpaqueBootToken();
    const database = createDriverInstanceDatabase(bootToken.hash);

    currentSandbox = createSandboxHandle({
      async wsConnect() {
        return new Response("driver socket unavailable", { status: 500 });
      },
    });

    await expect(
      connectDriverInstanceSandboxSocket(
        {
          bootToken: bootToken.encoded,
          port: 50_665,
          sandboxId: "01J0000000000000000000000D",
          traceparent: "traceparent-1",
        },
        {
          acceptDriverSocket: async () => {
            throw new Error("Socket should not be accepted.");
          },
          env: createApiBindings(database),
          requireDriverInstanceId: () => "driver-1",
        },
      ),
    ).rejects.toThrow();
  });
});
