import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  applyAgUiEventsToSessionLiveState,
  createInitialSessionLiveState,
  EventType,
} from "@mosoo/ag-ui-session";
import type { AgUiSessionEvent } from "@mosoo/ag-ui-session";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, ProjectId, SessionId } from "@mosoo/id";

import { writeSessionViewerSocketHeaders } from "../src/modules/sessions/infrastructure/session/socket-headers";
import { SessionViewerSocketHub } from "../src/modules/sessions/infrastructure/session/viewer-socket-hub";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertOwnerSession,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";

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

  return { connect, hub };
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
});
