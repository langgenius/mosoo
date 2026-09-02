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
import { loadSessionViewerStateSnapshot } from "../src/modules/sessions/infrastructure/session-viewer-live-snapshot.repository";
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
import { insertRuntimeEvent } from "./public-thread-api-fixtures";

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
  const stored = new Map<string, unknown>();
  const storage = {
    delete: async (key: string) => stored.delete(key),
    deleteAlarm: async () => {},
    get: async <T>(key: string) => stored.get(key) as T | undefined,
    put: async (key: string, value: unknown) => {
      stored.set(key, value);
    },
    setAlarm: async () => {},
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

function mutateAfterFirstViewerSnapshotRead(
  database: SqliteD1Database,
  mutate: () => Promise<void>,
): { database: D1Database; readCount: () => number } {
  let mutated = false;
  let readCount = 0;

  function wrapStatement(statement: D1PreparedStatement, query: string): D1PreparedStatement {
    return new Proxy(statement, {
      get(target, property) {
        if (property === "all" || property === "first" || property === "raw") {
          return async (...args: unknown[]) => {
            const read = Reflect.get(target, property) as (
              ...values: unknown[]
            ) => Promise<unknown>;
            const result = await read.apply(target, args);
            if (query.includes("session_agent_task_snapshot")) {
              readCount += 1;
              if (!mutated) {
                mutated = true;
                await mutate();
              }
            }
            return result;
          };
        }
        if (property === "bind") {
          return (...values: unknown[]) => wrapStatement(target.bind(...values), query);
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
          return (query: string) => wrapStatement(target.prepare(query), query);
        }
        const value: unknown = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
    readCount: () => readCount,
  };
}

function failFirstViewerSnapshotRead(database: SqliteD1Database): D1Database {
  let failed = false;

  function wrapStatement(statement: D1PreparedStatement, query: string): D1PreparedStatement {
    return new Proxy(statement, {
      get(target, property) {
        if (property === "all" || property === "first" || property === "raw") {
          return async (...args: unknown[]) => {
            if (!failed && query.includes("session_agent_task_snapshot")) {
              failed = true;
              throw new Error("injected initial viewer snapshot failure");
            }

            const read = Reflect.get(target, property) as (
              ...values: unknown[]
            ) => Promise<unknown>;
            return read.apply(target, args);
          };
        }
        if (property === "bind") {
          return (...values: unknown[]) => wrapStatement(target.bind(...values), query);
        }
        const value: unknown = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  return new Proxy(database, {
    get(target, property) {
      if (property === "prepare") {
        return (query: string) => wrapStatement(target.prepare(query), query);
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function installTestWebSocketPair(): { restore(): void; sockets: TestSocket[] } {
  const sockets: TestSocket[] = [];
  const originalWebSocketPair = Reflect.get(globalThis, "WebSocketPair");
  Reflect.set(globalThis, "WebSocketPair", function TestWebSocketPair() {
    const client = new TestSocket();
    const server = new TestSocket();
    sockets.push(client, server);
    return [client, server];
  });

  return {
    restore() {
      if (originalWebSocketPair === undefined) {
        Reflect.deleteProperty(globalThis, "WebSocketPair");
      } else {
        Reflect.set(globalThis, "WebSocketPair", originalWebSocketPair);
      }
    },
    sockets,
  };
}

function createViewerSocketRequest(): Request {
  const headers = new Headers({ upgrade: "websocket" });
  writeSessionViewerSocketHeaders(headers, {
    publicOrigin: "https://mosoo.ai",
    projectId: PUBLIC_API_TEST_IDS.project,
    sessionId: SESSION_ID,
    viewer: VIEWER,
  });
  return new Request("https://session.internal/viewer/ws", { headers });
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
  test("retries a viewer snapshot when its durable cursor changes mid-read", async () => {
    const database = await createDatabase();
    const messageId = "01J0000000000000000000002E";
    const guarded = mutateAfterFirstViewerSnapshotRead(database, async () => {
      await insertRuntimeEvent(database, {
        eventId: "01J0000000000000000000002F",
        kind: "message.added",
        occurredAt: Date.now(),
        payload: { content: "Committed during snapshot.", messageId, role: "agent" },
        runId: RUN_ID,
        seq: 1,
        sessionId: SESSION_ID,
      });
      await database
        .prepare("UPDATE session SET runtime_event_seq_cursor = 1 WHERE id = ?")
        .bind(SESSION_ID)
        .run();
    });

    const snapshot = await loadSessionViewerStateSnapshot(guarded.database, {
      sessionId: SESSION_ID,
      viewerId: VIEWER.id,
    });

    expect(guarded.readCount()).toBe(2);
    expect(snapshot.runtimeEventSeqCursor).toBe(1);
    expect(snapshot.state.messages).toContainEqual(
      expect.objectContaining({ content: "Committed during snapshot.", id: messageId }),
    );
  });

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
        projectId: PUBLIC_API_TEST_IDS.project,
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

      const durableMessageId = "01J0000000000000000000002A";
      await insertRuntimeEvent(database, {
        eventId: "01J0000000000000000000002B",
        kind: "message.added",
        occurredAt: Date.now(),
        payload: {
          content: "Durable replay content.",
          messageId: durableMessageId,
          role: "agent",
        },
        runId: RUN_ID,
        seq: 1,
        sessionId: SESSION_ID,
      });
      database.execute(`
        UPDATE session
        SET runtime_event_seq_cursor = 1
        WHERE id = '${SESSION_ID}';
      `);

      expect(
        hub.connect(
          new Request("https://session.internal/viewer/ws", {
            headers: new Headers(headers),
          }),
        ).status,
      ).toBe(101);
      const secondServer = sockets[3];
      if (!secondServer) {
        throw new Error("Expected a second server websocket.");
      }
      await Promise.all(pending);
      await hub.broadcastStateSync();

      const durableSnapshot = parseAgUiSessionEventJson(server.frames.at(-1) ?? "");
      const secondDurableSnapshot = parseAgUiSessionEventJson(secondServer.frames.at(-1) ?? "");
      expect(secondDurableSnapshot).toEqual(durableSnapshot);
      expect(durableSnapshot.type).toBe("STATE_SNAPSHOT");
      if (durableSnapshot.type !== "STATE_SNAPSHOT") {
        throw new Error("Expected durable state snapshot.");
      }
      expect(durableSnapshot.snapshot.messages).toEqual([
        expect.objectContaining({
          content: "Durable replay content.",
          id: durableMessageId,
        }),
      ]);
      expect(durableSnapshot.snapshot.viewerId).toBe(VIEWER.id);

      const framesBeforeReplay = server.frames.length;
      await hub.broadcastEvents(
        [
          {
            delta: " must-not-repeat",
            messageId: durableMessageId,
            type: "TEXT_MESSAGE_CONTENT",
          },
        ],
        1,
        0,
      );
      expect(server.frames).toHaveLength(framesBeforeReplay);

      await insertRuntimeEvent(database, {
        eventId: "01J0000000000000000000002C",
        kind: "message.delta",
        occurredAt: Date.now(),
        payload: {
          content: " Appended once.",
          messageId: durableMessageId,
        },
        runId: RUN_ID,
        seq: 2,
        sessionId: SESSION_ID,
      });
      database.execute(`
        UPDATE session
        SET runtime_event_seq_cursor = 2
        WHERE id = '${SESSION_ID}';
      `);
      await hub.broadcastEvents(
        [
          {
            delta: " Appended once.",
            messageId: durableMessageId,
            type: "TEXT_MESSAGE_CONTENT",
          },
        ],
        2,
        1,
      );

      await insertRuntimeEvent(database, {
        eventId: "01J0000000000000000000002D",
        kind: "message.delta",
        occurredAt: Date.now(),
        payload: {
          content: " Gap recovered.",
          messageId: durableMessageId,
        },
        runId: RUN_ID,
        seq: 3,
        sessionId: SESSION_ID,
      });
      database.execute(`
        UPDATE session
        SET runtime_event_seq_cursor = 3
        WHERE id = '${SESSION_ID}';
      `);
      await hub.broadcastEvents(
        [
          {
            delta: " Gap recovered.",
            messageId: durableMessageId,
            type: "TEXT_MESSAGE_CONTENT",
          },
        ],
        3,
        0,
      );
      const recoveredGapSnapshot = parseAgUiSessionEventJson(server.frames.at(-1) ?? "");
      expect(recoveredGapSnapshot).toMatchObject({
        snapshot: {
          messages: [
            expect.objectContaining({
              content: "Durable replay content. Appended once. Gap recovered.",
              id: durableMessageId,
            }),
          ],
        },
        type: "STATE_SNAPSHOT",
      });

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
      expect(reconnectSnapshot.snapshot.messages).toEqual([
        expect.objectContaining({
          content: "Durable replay content. Appended once. Gap recovered.",
          id: durableMessageId,
        }),
      ]);

      await insertRuntimeEvent(database, {
        eventId: "01J0000000000000000000002G",
        kind: "message.delta",
        occurredAt: Date.now(),
        payload: {
          content: " Alarm recovered.",
          messageId: durableMessageId,
        },
        runId: RUN_ID,
        seq: 4,
        sessionId: SESSION_ID,
      });
      database.execute(`
        UPDATE session
        SET runtime_event_seq_cursor = 4
        WHERE id = '${SESSION_ID}';
      `);
      await hub.handleAlarm();

      const alarmSnapshot = parseAgUiSessionEventJson(server.frames.at(-1) ?? "");
      expect(alarmSnapshot).toMatchObject({
        snapshot: {
          messages: [
            expect.objectContaining({
              content: "Durable replay content. Appended once. Gap recovered. Alarm recovered.",
              id: durableMessageId,
            }),
          ],
        },
        type: "STATE_SNAPSHOT",
      });
      expect(server.attachment).toMatchObject({ runtimeEventSeqCursor: 4 });
    } finally {
      if (originalWebSocketPair === undefined) {
        Reflect.deleteProperty(globalThis, "WebSocketPair");
      } else {
        Reflect.set(globalThis, "WebSocketPair", originalWebSocketPair);
      }
    }
  });

  test("retries the authoritative snapshot before delivering a delta after initial sync fails", async () => {
    const database = await createDatabase();
    const { ctx, pending } = createContext();
    const pair = installTestWebSocketPair();
    const hub = new SessionViewerSocketHub({
      ctx,
      env: {
        ...createPublicHttpTestBindings(database),
        DB: failFirstViewerSnapshotRead(database),
      } as ApiBindings,
      getSessionId: () => SESSION_ID,
      rememberSessionId: () => {},
      withSessionLogContext: (operation) => operation(),
    });

    try {
      expect(hub.connect(createViewerSocketRequest()).status).toBe(101);
      await Promise.allSettled(pending);
      const server = pair.sockets[1];
      if (!server) {
        throw new Error("Expected a server websocket.");
      }
      expect(server.frames).toEqual([]);
      expect(server.attachment).not.toHaveProperty("runtimeEventSeqCursor");

      const messageId = "01J0000000000000000000002H";
      await insertRuntimeEvent(database, {
        eventId: "01J0000000000000000000002J",
        kind: "message.added",
        occurredAt: Date.now(),
        payload: { content: "Recovered base.", messageId, role: "agent" },
        runId: RUN_ID,
        seq: 1,
        sessionId: SESSION_ID,
      });
      database.execute(`
        UPDATE session
        SET runtime_event_seq_cursor = 1
        WHERE id = '${SESSION_ID}';
      `);

      await hub.broadcastEvents(
        [{ delta: "Recovered base.", messageId, type: "TEXT_MESSAGE_CONTENT" }],
        1,
        0,
      );

      expect(server.frames).toHaveLength(1);
      expect(parseAgUiSessionEventJson(server.frames[0] ?? "")).toMatchObject({
        snapshot: {
          messages: [expect.objectContaining({ content: "Recovered base.", id: messageId })],
        },
        type: "STATE_SNAPSHOT",
      });
      expect(server.attachment).toMatchObject({ runtimeEventSeqCursor: 1 });
    } finally {
      pair.restore();
    }
  });

  test("recovers the Session identity from socket attachments after hibernation", async () => {
    const database = await createDatabase();
    const { ctx, pending } = createContext();
    const pair = installTestWebSocketPair();
    const initialHub = new SessionViewerSocketHub({
      ctx,
      env: createPublicHttpTestBindings(database) as ApiBindings,
      getSessionId: () => SESSION_ID,
      rememberSessionId: () => {},
      withSessionLogContext: (operation) => operation(),
    });

    try {
      expect(initialHub.connect(createViewerSocketRequest()).status).toBe(101);
      await Promise.all(pending);
      const server = pair.sockets[1];
      if (!server) {
        throw new Error("Expected a server websocket.");
      }

      const messageId = "01J0000000000000000000002K";
      await insertRuntimeEvent(database, {
        eventId: "01J0000000000000000000002M",
        kind: "message.added",
        occurredAt: Date.now(),
        payload: { content: "Alarm recovery.", messageId, role: "agent" },
        runId: RUN_ID,
        seq: 1,
        sessionId: SESSION_ID,
      });
      database.execute(`
        UPDATE session
        SET runtime_event_seq_cursor = 1
        WHERE id = '${SESSION_ID}';
      `);

      const recoveredSessionIds: string[] = [];
      const hibernatedHub = new SessionViewerSocketHub({
        ctx,
        env: createPublicHttpTestBindings(database) as ApiBindings,
        getSessionId: () => null,
        rememberSessionId: (sessionId) => recoveredSessionIds.push(sessionId),
        withSessionLogContext: (operation) => operation(),
      });
      await hibernatedHub.handleAlarm();

      expect(recoveredSessionIds).toContain(SESSION_ID);
      expect(parseAgUiSessionEventJson(server.frames.at(-1) ?? "")).toMatchObject({
        snapshot: {
          messages: [expect.objectContaining({ content: "Alarm recovery.", id: messageId })],
        },
        type: "STATE_SNAPSHOT",
      });
      expect(server.attachment).toMatchObject({ runtimeEventSeqCursor: 1 });
    } finally {
      pair.restore();
    }
  });
});
