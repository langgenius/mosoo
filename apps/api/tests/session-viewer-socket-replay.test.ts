import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";

import {
  applyAgUiEventsToSessionLiveState,
  createInitialSessionLiveState,
  EventType,
} from "@mosoo/ag-ui-session";
import type { AgUiSessionEvent } from "@mosoo/ag-ui-session";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, ProjectId, SessionId } from "@mosoo/id";
import { createRuntimeEvent } from "@mosoo/runtime-events";

import { createThoughtContentEvents } from "../../driver/src/runtimes/thought-content";
import { projectRuntimeEventToSessionDeliveryEvents } from "../src/modules/sessions/application/session-live-state.service";
import { writeSessionViewerSocketHeaders } from "../src/modules/sessions/infrastructure/session/socket-headers";
import { SessionViewerSocketHub } from "../src/modules/sessions/infrastructure/session/viewer-socket-hub";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertOwnerSession,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";
import { insertRuntimeEvent } from "./public-thread-api-fixtures";

const SESSION_ID = parsePlatformId<SessionId>(PUBLIC_API_TEST_IDS.ownerSession, "session id");

class TestViewerSocket {
  attachment: unknown = null;
  readyState: number = WebSocket.OPEN;
  readonly sent: string[] = [];

  close(): void {
    this.readyState = WebSocket.CLOSED;
  }

  deserializeAttachment(): unknown {
    return this.attachment;
  }

  send(frame: string): void {
    this.sent.push(frame);
  }

  serializeAttachment(value: unknown): void {
    this.attachment = value;
  }
}

beforeAll(() => {
  Object.assign(globalThis, {
    WebSocketPair: class {
      0 = new TestViewerSocket();
      1 = new TestViewerSocket();
    },
  });
});

afterAll(() => {
  Reflect.deleteProperty(globalThis, "WebSocketPair");
});

async function createHub() {
  const database = await createPublicHttpContractDatabase();
  await insertOwnerSession(database);
  const sockets: TestViewerSocket[] = [];
  const pending: Promise<unknown>[] = [];
  const ctx = {
    acceptWebSocket: (socket: TestViewerSocket) => sockets.push(socket),
    getWebSockets: () => sockets,
    storage: { delete: async () => true, deleteAlarm: async () => {} },
    waitUntil: (promise: Promise<unknown>) => pending.push(promise),
  } as unknown as DurableObjectState;
  const hub = new SessionViewerSocketHub({
    ctx,
    env: createPublicHttpTestBindings(database) as ApiBindings,
    rememberSessionId: () => {},
    withSessionLogContext: (fn) => fn(),
  });

  async function connect(): Promise<TestViewerSocket> {
    const headers = new Headers({ upgrade: "websocket" });
    writeSessionViewerSocketHeaders(headers, {
      projectId: parsePlatformId<ProjectId>(PUBLIC_API_TEST_IDS.project, "project id"),
      publicOrigin: "https://app.example.com",
      sessionId: SESSION_ID,
      viewer: {
        email: "owner@example.com",
        emailVerified: true,
        id: parsePlatformId<AccountId>(PUBLIC_API_TEST_IDS.ownerAccount, "owner id"),
        imageUrl: null,
        name: "Owner",
      },
    });
    hub.connect(new Request("https://session.internal/viewer/ws", { headers }));
    await Promise.all(pending.splice(0));
    return sockets.at(-1)!;
  }

  return { connect, database, hub };
}

function receivedEvents(socket: TestViewerSocket): AgUiSessionEvent[] {
  return socket.sent.map((frame) => JSON.parse(frame) as AgUiSessionEvent);
}

function viewerMessages(socket: TestViewerSocket) {
  return applyAgUiEventsToSessionLiveState(
    createInitialSessionLiveState({ sessionId: SESSION_ID, title: null, viewerId: "" }),
    receivedEvents(socket),
  ).messages.map(({ content, id }) => ({ content, id }));
}

const assistantStart: AgUiSessionEvent = {
  messageId: "assistant-1",
  role: "assistant",
  type: EventType.TEXT_MESSAGE_START,
};

function assistantDelta(delta: string): AgUiSessionEvent {
  return { delta, messageId: "assistant-1", type: EventType.TEXT_MESSAGE_CONTENT };
}

describe("Session viewer socket replay", () => {
  test("a viewer joining mid-turn receives the snapshot followed by the turn so far", async () => {
    const { connect, hub } = await createHub();
    await hub.broadcastEvents([assistantStart, assistantDelta("Hel")]);

    const first = await connect();
    expect(receivedEvents(first).map((event) => event.type)).toEqual([
      EventType.STATE_SNAPSHOT,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
    ]);

    await hub.broadcastEvents([assistantDelta("lo")]);
    const second = await connect();

    for (const socket of [first, second]) {
      expect(viewerMessages(socket)).toEqual([{ content: "Hello", id: "assistant-1" }]);
    }
  });

  test("a state sync drops the replayed turn once D1 holds its outcome", async () => {
    const { connect, hub } = await createHub();
    await hub.broadcastEvents([assistantStart, assistantDelta("Hello")]);
    const first = await connect();

    await hub.broadcastStateSync();
    const second = await connect();

    expect(receivedEvents(first).at(-1)?.type).toBe(EventType.STATE_SNAPSHOT);
    expect(receivedEvents(second).map((event) => event.type)).toEqual([EventType.STATE_SNAPSHOT]);
  });

  test.each(["eviction", "clear"] as const)(
    "reloads a snapshot when replay frames disappear during its read: %s",
    async (mode) => {
      const { connect, database, hub } = await createHub();
      const content = "x".repeat(8 * 1024 * 1024);
      const updates = createThoughtContentEvents("thought-1", content);
      let seq = 0;
      const persist = async (event: (typeof updates)[number]) => {
        seq++;
        const id = seq.toString().padStart(26, "0");
        await insertRuntimeEvent(database, {
          id,
          kind: event.kind,
          occurredAt: seq,
          payload: event.payload,
          seq,
          sessionId: SESSION_ID,
        });
        return createRuntimeEvent({
          id,
          kind: event.kind,
          occurredAt: new Date(seq).toISOString(),
          payload: event.payload,
          sessionId: SESSION_ID,
        });
      };
      await persist(updates[0]);

      let interrupted = false;
      const prepare = database.prepare.bind(database);
      const prepareSpy = spyOn(database, "prepare").mockImplementation((query) => {
        const statement = prepare(query);
        if (!query.includes('"canonical_event_json" is not null')) return statement;
        const bind = statement.bind.bind(statement);
        statement.bind = (...values) => {
          const bound = bind(...values);
          const raw = bound.raw;
          bound.raw = async <T = unknown[]>(options?: { columnNames?: boolean }) => {
            if (!interrupted) {
              interrupted = true;
              const events = [];
              for (const update of updates.slice(1)) events.push(await persist(update));
              events.push(
                await persist({ kind: "thought.completed", payload: { thoughtId: "thought-1" } }),
              );
              await hub.broadcastEvents(events.flatMap(projectRuntimeEventToSessionDeliveryEvents));
              if (mode === "clear") await hub.broadcastStateSync();
            }
            return raw<T>(options);
          };
          return bound;
        };
        return statement;
      });

      try {
        const socket = await connect();
        expect(interrupted).toBe(true);
        const state = applyAgUiEventsToSessionLiveState(
          createInitialSessionLiveState({ sessionId: SESSION_ID, title: null, viewerId: "" }),
          receivedEvents(socket),
        );
        expect(state.messages.find((message) => message.id === "thought-1")?.segments).toEqual([
          { kind: "reasoning", status: "completed", text: content },
        ]);
      } finally {
        prepareSpy.mockRestore();
      }
    },
  );
});
