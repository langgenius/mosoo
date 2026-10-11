import { expect, test } from "bun:test";

import { PUBLIC_THREAD_EVENTS_MAX_LIMIT } from "@mosoo/contracts/public-api";
import type { RuntimeEventKind } from "@mosoo/runtime-events";

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
  readJson,
  requestPublicApi,
} from "./public-thread-api-fixtures";

test.each([
  { citation: "", tail: "" },
  { citation: "\uE200cite\uE202hidden\uE201", tail: "" },
  { citation: "", tail: "\uE200ci" },
])(
  "public thought history replaces previews and SSE keeps chunk IDs across polls and citations %j",
  async ({ citation, tail }) => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();
    const live = createPublicEventSessionNamespace();
    await insertOwnerSession(database);
    const request = (suffix: string) =>
      requestPublicApi(
        app,
        database,
        new Request(
          `https://api.example.com/api/v2/threads/${PUBLIC_API_TEST_IDS.ownerSession}/events${suffix}`,
          { headers: { Authorization: bearer(TOKENS.owner) } },
        ),
        { sessionNamespace: live.binding },
      );
    const insert = (seq: number, kind: RuntimeEventKind, payload: unknown) =>
      insertRuntimeEvent(database, {
        kind,
        occurredAt: seq * 1000,
        payload,
        seq,
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
      });
    const readUntil = async (
      reader: ReadableStreamDefaultReader<Uint8Array>,
      marker: string,
    ): Promise<string> => {
      let text = "";
      while (!text.includes(marker)) {
        const chunk = await Promise.race([
          reader.read(),
          Bun.sleep(3000).then(() => {
            throw new Error(`Timed out waiting for ${marker}.`);
          }),
        ]);
        if (chunk.done) throw new Error(`SSE closed before ${marker}.`);
        text += new TextDecoder().decode(chunk.value);
      }
      return text;
    };
    const eventData = (text: string) =>
      text
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => JSON.parse(line.slice(6)) as { content: string; id: string; type: string });

    await insert(1, "thought.delta", { thoughtId: "a", contentDelta: "Incorrect preview" });
    const firstChunk = `Final ${citation.slice(0, 3)}`;
    await insert(2, "thought.updated", { thoughtId: "a", content: firstChunk, offset: 0 });
    const response = await request("/stream");
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Expected SSE body.");
    let text = await readUntil(reader, "id: 01J00000000000000000000011");
    try {
      await insert(3, "thought.delta", { thoughtId: "a", contentDelta: "Late preview" });
      await insert(4, "thought.updated", {
        thoughtId: "a",
        content: `${citation.slice(3)}text${tail}`,
        offset: firstChunk.length,
      });
      live.emit();
      text += await readUntil(reader, "id: 01J00000000000000000000013");
      await insert(5, "thought.cancelled", { thoughtId: "a" });
      await insert(6, "thought.updated", { thoughtId: "b", content: "", offset: 0 });
      await insert(7, "thought.delta", { thoughtId: "b", contentDelta: "Cleared preview" });
      await insert(8, "message.added", { content: "Done", messageId: "final", role: "agent" });
      live.emit();
      text += await readUntil(reader, "id: 01J00000000000000000000017");
    } finally {
      await reader.cancel();
    }

    const emitted = eventData(text);
    expect(emitted.map((event) => event.content)).toEqual([
      "Final ",
      "text",
      ...(tail ? [tail] : []),
      "",
      "Done",
    ]);
    expect(new Set(emitted.map((event) => event.id)).size).toBe(emitted.length);
    expect(emitted.filter((event) => event.type === "agent.thinking.delta")).toHaveLength(
      tail ? 4 : 3,
    );
    const history = await readJson(await request(""));
    expect(history["events"]).toMatchObject([
      { content: `Final text${tail}`, type: "agent.thinking.delta" },
      { content: "Done", type: "agent.message.delta" },
    ]);

    const reconnected = (await request("/stream")).body?.getReader();
    if (!reconnected) throw new Error("Expected SSE body.");
    try {
      const replay = await readUntil(reconnected, "id: 01J00000000000000000000017");
      expect(eventData(replay)).toEqual(emitted);
    } finally {
      await reconnected.cancel();
      live.close();
    }
  },
);

test("SSE omits a thought whose first chunk precedes the bounded history window", async () => {
  const database = await createPublicHttpContractDatabase();
  const app = createPublicThreadApiTestApp();
  const live = createPublicEventSessionNamespace();
  await insertOwnerSession(database);
  for (const [index, content] of ["\uE200cite\uE202", "hidden\uE201 suffix"].entries()) {
    await insertRuntimeEvent(database, {
      kind: "thought.updated",
      occurredAt: (index + 1) * 1000,
      payload: { thoughtId: "a", content, offset: index === 0 ? 0 : 6 },
      seq: index + 1,
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
    });
  }
  await insertRuntimeEvent(database, {
    kind: "message.added",
    occurredAt: 3000,
    payload: { content: "Visible event", messageId: "message", role: "agent" },
    seq: 3,
    sessionId: PUBLIC_API_TEST_IDS.ownerSession,
  });
  await database
    .prepare("UPDATE session_event SET seq = ? WHERE seq = 2")
    .bind(PUBLIC_THREAD_EVENTS_MAX_LIMIT + 2)
    .run();
  await database
    .prepare(`
      WITH RECURSIVE indices(value) AS (
        SELECT 4 UNION ALL SELECT value + 1 FROM indices WHERE value < ?
      )
      INSERT INTO session_event (
        id, session_id, source_event_id, source, seq, event_type, content_text,
        created_at, occurred_at, ended_at, family, process_status, process_type, visibility
      )
      SELECT printf('%026d', value), session_id, printf('%026d', value), source, value,
        event_type, content_text, created_at, occurred_at, ended_at, family,
        process_status, process_type, visibility
      FROM session_event CROSS JOIN indices WHERE seq = 3
    `)
    .bind(PUBLIC_THREAD_EVENTS_MAX_LIMIT + 1)
    .run();
  const response = await requestPublicApi(
    app,
    database,
    new Request(
      `https://api.example.com/api/v2/threads/${PUBLIC_API_TEST_IDS.ownerSession}/events/stream?limit=1`,
      { headers: { Authorization: bearer(TOKENS.owner) } },
    ),
    { sessionNamespace: live.binding },
  );
  expect(response.status).toBe(200);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Expected SSE body.");
  try {
    await reader.read();
    const event = await reader.read();
    const text = new TextDecoder().decode(event.value);
    expect(text).toContain("Visible event");
    expect(text).not.toContain("hidden");
    expect(text).not.toContain("agent.thinking.delta");
  } finally {
    await reader.cancel();
    live.close();
  }
});
