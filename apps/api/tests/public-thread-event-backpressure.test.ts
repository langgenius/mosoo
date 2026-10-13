import { expect, spyOn, test } from "bun:test";

import type { PublicThreadEventLogEntry } from "@mosoo/contracts/public-api";

import {
  PUBLIC_API_TEST_IDS,
  TOKENS,
  createPublicHttpContractDatabase,
  insertOwnerSession,
} from "./helpers/public-api-http-test-fixture";
import {
  bearer,
  createPublicEventSessionNamespace,
  createPublicThreadApiTestApp,
  insertRuntimeEvent,
  requestPublicApi,
} from "./public-thread-api-fixtures";

async function createFixture() {
  const database = await createPublicHttpContractDatabase();
  const app = createPublicThreadApiTestApp();
  const live = createPublicEventSessionNamespace();
  await insertOwnerSession(database);

  return {
    database,
    live,
    insert: (seq: number, content: string) =>
      insertRuntimeEvent(database, {
        kind: "message.added",
        occurredAt: seq * 1000,
        payload: { content, messageId: `message-${seq}`, role: "agent" },
        seq,
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
      }),
    open: async (signal?: AbortSignal) => {
      const response = await requestPublicApi(
        app,
        database,
        new Request(
          `https://api.example.com/api/v2/threads/${PUBLIC_API_TEST_IDS.ownerSession}/events/stream`,
          { headers: { Authorization: bearer(TOKENS.owner) }, signal },
        ),
        { sessionNamespace: live.binding },
      );
      expect(response.status).toBe(200);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Expected SSE body.");
      return reader;
    },
  };
}

async function readText(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const chunk = await reader.read();
  if (chunk.done) throw new Error("SSE closed before the expected event.");
  return new TextDecoder().decode(chunk.value);
}

async function readEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<PublicThreadEventLogEntry> {
  const text = await readText(reader);
  const data = text.split("\n").find((line) => line.startsWith("data: "));
  if (!data) throw new Error(`Expected SSE event, received ${text}.`);
  const event = JSON.parse(data.slice(6)) as PublicThreadEventLogEntry;
  expect(text).toContain(`id: ${event.id}\n`);
  return event;
}

test("SSE stops reading while backpressured and resumes every event in order", async () => {
  const fixture = await createFixture();
  const contents = Array.from({ length: 8 }, (_, index) => `${index}:${"x".repeat(400 * 1024)}`);
  await fixture.insert(1, contents[0]);
  await fixture.insert(2, contents[1]);
  const prepare = spyOn(fixture.database, "prepare");
  const eventReads = () =>
    prepare.mock.calls.filter(
      ([query]) => query.startsWith("select ") && query.includes(' from "session_event" '),
    ).length;
  const bodyReads = () =>
    prepare.mock.calls.filter(([query]) => query.startsWith('select "content_text",')).length;
  const reader = await fixture.open();
  try {
    const connectedReads = eventReads();
    await fixture.insert(3, contents[2]);
    fixture.live.emit();
    await Bun.sleep(0);
    expect(bodyReads()).toBe(0);
    expect(eventReads()).toBe(connectedReads);

    expect(await readText(reader)).toBe(": connected\n\n");
    await Bun.sleep(0);
    expect(bodyReads()).toBe(1);
    const pausedReads = eventReads();
    for (let seq = 4; seq <= 8; seq++) {
      await fixture.insert(seq, contents[seq - 1]);
      fixture.live.emit();
      await Bun.sleep(0);
      expect(eventReads()).toBe(pausedReads);
    }

    const events: PublicThreadEventLogEntry[] = [];
    for (let index = 0; index < contents.length; index++) {
      events.push(await readEvent(reader));
    }
    expect(events.map((event) => event.content)).toEqual(contents);
    expect(events.map((event) => event.id)).toEqual(
      Array.from({ length: 8 }, (_, index) => `01J0000000000000000000001${index}`),
    );
    expect(bodyReads()).toBeGreaterThan(2);

    const replay = await fixture.open();
    try {
      expect(await readText(replay)).toBe(": connected\n\n");
      for (const event of events) {
        expect(await readEvent(replay)).toEqual(event);
      }
    } finally {
      await replay.cancel();
    }
  } finally {
    await reader.cancel();
    prepare.mockRestore();
    fixture.live.close();
  }
});

test.each(["cancel", "abort"] as const)(
  "SSE %s resolves a pending read and closes its wakeup socket",
  async (stop) => {
    const fixture = await createFixture();
    const session = fixture.live.binding.get(
      fixture.live.binding.idFromName(PUBLIC_API_TEST_IDS.ownerSession),
    );
    const fetch = spyOn(session, "fetch");
    const prepare = spyOn(fixture.database, "prepare");
    const abort = new AbortController();
    const reader = await fixture.open(abort.signal);
    try {
      const socket = (await fetch.mock.results[0]!.value).webSocket;
      expect(socket?.readyState).toBe(WebSocket.OPEN);
      expect(await readText(reader)).toBe(": connected\n\n");
      const pendingRead = reader.read();
      await Bun.sleep(0);
      const reads = prepare.mock.calls.length;
      if (stop === "cancel") await reader.cancel();
      else abort.abort();
      await expect(pendingRead).resolves.toEqual({ done: true, value: undefined });
      await expect(reader.closed).resolves.toBeUndefined();
      expect(socket?.readyState).toBe(WebSocket.CLOSED);
      fixture.live.emit();
      await Bun.sleep(0);
      expect(prepare.mock.calls).toHaveLength(reads);
    } finally {
      await reader.cancel();
      prepare.mockRestore();
      fetch.mockRestore();
      fixture.live.close();
    }
  },
);

test("SSE resumes live notifications after a backpressured heartbeat", async () => {
  const fixture = await createFixture();
  let now = Date.now();
  const clock = spyOn(Date, "now").mockImplementation(() => now);
  const prepare = spyOn(fixture.database, "prepare");
  const reader = await fixture.open();
  try {
    expect(await readText(reader)).toBe(": connected\n\n");
    await Bun.sleep(0);
    now += 16_000;
    fixture.live.emit();
    await Bun.sleep(0);

    await fixture.insert(1, "Queued during heartbeat");
    const reads = prepare.mock.calls.length;
    fixture.live.emit();
    await Bun.sleep(0);
    expect(prepare.mock.calls).toHaveLength(reads);
    expect(await readText(reader)).toBe(": keepalive\n\n");
    expect(await readEvent(reader)).toMatchObject({
      content: "Queued during heartbeat",
      id: "01J00000000000000000000010",
    });

    const pendingEvent = readEvent(reader);
    let received: PublicThreadEventLogEntry | undefined;
    void pendingEvent.then((event) => {
      received = event;
    });
    await Bun.sleep(0);
    await fixture.insert(2, "Woken after heartbeat");
    fixture.live.emit();
    await Bun.sleep(0);
    expect(received).toMatchObject({
      content: "Woken after heartbeat",
      id: "01J00000000000000000000011",
    });
    await pendingEvent;
  } finally {
    await reader.cancel();
    prepare.mockRestore();
    clock.mockRestore();
    fixture.live.close();
  }
});
