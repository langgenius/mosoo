import { describe, expect, test } from "bun:test";

import {
  applyAgUiEventsToSessionLiveState,
  createInitialSessionLiveState,
  createServerCustomEvent,
  createViewerCustomEvent,
  MOSOO_CUSTOM_EVENT,
  parseAgUiSessionEventJson,
} from "@mosoo/ag-ui-session";
import { createPromiseDeferred } from "@mosoo/effects";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { writeSessionViewerSocketHeaders } from "../src/modules/sessions/infrastructure/session/socket-headers";
import { SessionViewerSocketHub } from "../src/modules/sessions/infrastructure/session/viewer-socket-hub";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertOwnerSession,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/sqlite-d1";

const DRIVER_ID = PUBLIC_API_TEST_IDS.driverOwner;
const RUN_ID = PUBLIC_API_TEST_IDS.run;
const SESSION_ID = PUBLIC_API_TEST_IDS.ownerSession;
const VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: PUBLIC_API_TEST_IDS.ownerAccount,
  imageUrl: null,
  name: "Owner",
};

class TestSocket {
  attachment: unknown = null;
  readonly frames: string[] = [];
  readyState = WebSocket.OPEN;

  close(): void {
    this.readyState = WebSocket.CLOSED;
  }

  deserializeAttachment(): unknown {
    return this.attachment;
  }

  send(frame: string): void {
    this.frames.push(frame);
  }

  serializeAttachment(attachment: unknown): void {
    this.attachment = attachment;
  }
}

function createContext(): {
  ctx: DurableObjectState;
  pending: Promise<unknown>[];
} {
  const accepted: { socket: TestSocket; tags: string[] }[] = [];
  const pending: Promise<unknown>[] = [];
  const storage = {
    delete: async () => true,
    deleteAlarm: async () => {},
  };
  const ctx = {
    acceptWebSocket(socket: TestSocket, tags: string[]) {
      accepted.push({ socket, tags });
    },
    getWebSockets(tag?: string) {
      return accepted
        .filter(
          ({ socket, tags }) =>
            socket.readyState === WebSocket.OPEN && (tag === undefined || tags.includes(tag)),
        )
        .map(({ socket }) => socket);
    },
    storage,
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
  } as unknown as DurableObjectState;

  return { ctx, pending };
}

function deferFirstTaskSnapshotRead(database: SqliteD1Database): {
  database: D1Database;
  readStarted: Promise<void>;
  releaseRead: () => void;
} {
  const readStarted = createPromiseDeferred<void>();
  const releaseRead = createPromiseDeferred<void>();
  let deferred = false;

  function wrapStatement(statement: D1PreparedStatement): D1PreparedStatement {
    return new Proxy(statement, {
      get(target, property) {
        if (property === "all" || property === "first" || property === "raw") {
          return async (...args: unknown[]) => {
            const read = Reflect.get(target, property) as (
              ...values: unknown[]
            ) => Promise<unknown>;
            const result = await read.apply(target, args);

            if (!deferred) {
              deferred = true;
              readStarted.resolve();
              await releaseRead.promise;
            }

            return result;
          };
        }

        if (property === "bind") {
          return (...values: unknown[]) => wrapStatement(target.bind(...values));
        }

        const value: unknown = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  return {
    database: new Proxy(database, {
      get(target, property) {
        if (property === "prepare") {
          return (query: string) => {
            const statement = target.prepare(query);
            return query.includes("session_agent_task_snapshot")
              ? wrapStatement(statement)
              : statement;
          };
        }

        const value: unknown = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
    readStarted: readStarted.promise,
    releaseRead: () => {
      releaseRead.resolve();
    },
  };
}

async function createDatabase(): Promise<SqliteD1Database> {
  const database = await createPublicHttpContractDatabase();
  const now = Date.now();
  await insertOwnerSession(database);
  database.execute(`
    UPDATE session
    SET last_run_id = '${RUN_ID}', status = 'RUNNING'
    WHERE id = '${SESSION_ID}';

    INSERT INTO session_run (
      agent_id,
      created_at,
      created_by_account_id,
      driver_instance_id,
      id,
      model,
      provider,
      session_id,
      started_at,
      status,
      trace_id,
      trigger,
      updated_at
    ) VALUES (
      '${PUBLIC_API_TEST_IDS.agent}',
      ${now},
      '${VIEWER.id}',
      '${DRIVER_ID}',
      '${RUN_ID}',
      'gpt-5.4',
      'openai',
      '${SESSION_ID}',
      ${now},
      'running',
      'trace-1',
      'user_message',
      ${now}
    );

    INSERT INTO session_agent_task_snapshot (
      driver_instance_id,
      run_id,
      seq,
      session_id,
      tasks_json
    ) VALUES (
      '${DRIVER_ID}',
      '${RUN_ID}',
      1,
      '${SESSION_ID}',
      '{"tasks":[{"taskId":"stale"}]}'
    );
  `);
  return database;
}

describe("session viewer socket state ordering", () => {
  test("linearizes a cold initial snapshot before a concurrent task broadcast", async () => {
    const database = await createDatabase();
    const deferredRead = deferFirstTaskSnapshotRead(database);
    const bindings = {
      ...createPublicHttpTestBindings(database),
      DB: deferredRead.database,
    } as ApiBindings;
    const { ctx, pending } = createContext();
    const hub = new SessionViewerSocketHub({
      ctx,
      env: bindings,
      getSessionId: () => SESSION_ID,
      rememberSessionId: () => {},
      withSessionLogContext: (operation) => operation(),
    });
    const sockets: TestSocket[] = [];
    const originalWebSocketPair = Reflect.get(globalThis, "WebSocketPair");
    Reflect.set(globalThis, "WebSocketPair", function TestWebSocketPair() {
      const client = new TestSocket();
      const server = new TestSocket();
      sockets.push(client, server);
      return [client, server];
    });

    try {
      const headers = new Headers({ upgrade: "websocket" });
      writeSessionViewerSocketHeaders(headers, {
        publicOrigin: "https://mosoo.ai",
        appId: PUBLIC_API_TEST_IDS.app,
        sessionId: SESSION_ID,
        viewer: VIEWER,
      });
      expect(
        hub.connect(new Request("https://session.internal/viewer/ws", { headers })).status,
      ).toBe(101);
      const server = sockets[1];

      if (!server) {
        throw new Error("Expected a server websocket.");
      }

      await deferredRead.readStarted;
      database.execute(`
        UPDATE session_agent_task_snapshot
        SET seq = 2, tasks_json = '{"tasks":[{"taskId":"latest"}]}'
        WHERE session_id = '${SESSION_ID}';
      `);
      const latestTaskEvent = createServerCustomEvent(
        MOSOO_CUSTOM_EVENT.sessionTasksReplaced.name,
        {
          driverInstanceId: DRIVER_ID,
          runId: RUN_ID,
          tasks: [{ taskId: "latest" }],
        },
      );
      const broadcast = hub.broadcastEvents([latestTaskEvent]);

      await Promise.resolve();
      expect(server.frames).toEqual([]);

      deferredRead.releaseRead();
      await broadcast;
      await Promise.all(pending);

      const firstEvents = server.frames.map(parseAgUiSessionEventJson);
      expect(firstEvents.map((event) => event.type)).toEqual(["STATE_SNAPSHOT", "CUSTOM"]);
      const state = applyAgUiEventsToSessionLiveState(
        createInitialSessionLiveState({ sessionId: SESSION_ID, title: null, viewerId: VIEWER.id }),
        firstEvents,
      );
      expect(state.taskSnapshot?.tasks).toEqual([{ taskId: "latest" }]);

      await hub.handleSocketMessage(
        server as unknown as WebSocket,
        JSON.stringify(
          createViewerCustomEvent(MOSOO_CUSTOM_EVENT.sessionSyncRequest.name, {
            reason: "reconnect",
          }),
        ),
      );

      const reconnectSnapshot = parseAgUiSessionEventJson(server.frames.at(-1) ?? "");
      expect(reconnectSnapshot.type).toBe("STATE_SNAPSHOT");
      if (reconnectSnapshot.type !== "STATE_SNAPSHOT") {
        throw new Error("Expected reconnect state snapshot.");
      }
      expect(reconnectSnapshot.snapshot.taskSnapshot?.tasks).toEqual([{ taskId: "latest" }]);
    } finally {
      if (originalWebSocketPair === undefined) {
        Reflect.deleteProperty(globalThis, "WebSocketPair");
      } else {
        Reflect.set(globalThis, "WebSocketPair", originalWebSocketPair);
      }
    }
  });
});
