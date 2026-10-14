import { expect, spyOn, test } from "bun:test";

import { MAX_THOUGHT_CONTENT_BYTES } from "@mosoo/agent-driver/runtime-events";

import { createThoughtContentEvents } from "../../driver/src/runtimes/thought-content";
import {
  loadSessionState,
  loadSessionViewerState,
} from "../src/modules/sessions/application/session-live-state.service";
import {
  readSessionEventRowsAfterSeq,
  readSessionEventWindow,
  SESSION_EVENT_PAGE_MAX_BYTES,
  SESSION_EVENT_WINDOW_MAX_BYTES,
} from "../src/modules/sessions/infrastructure/session-event-read.repository";
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

test("reads a complete 16 MiB thought and bounds large history by serialized bytes", async () => {
  const database = await createPublicHttpContractDatabase();
  const app = createPublicThreadApiTestApp();
  const sessionId = PUBLIC_API_TEST_IDS.ownerSession;
  await insertOwnerSession(database);
  let seq = 0;
  let finalText = "";
  const history = async () => {
    const response = await requestPublicApi(
      app,
      database,
      new Request(`https://api.example.com/api/v2/threads/${sessionId}/events?limit=1000`, {
        headers: { Authorization: bearer(TOKENS.owner) },
      }),
    );
    expect(response.status).toBe(200);
    return readJson(response);
  };

  for (let thought = 0; thought < 5; thought++) {
    // The last thought is small in raw bytes but needs the same JSON budget as the others.
    finalText =
      thought === 4
        ? "\u0000".repeat(Math.floor(MAX_THOUGHT_CONTENT_BYTES / 6))
        : String(thought).repeat(MAX_THOUGHT_CONTENT_BYTES);
    for (const event of createThoughtContentEvents(`thought-${thought}`, finalText)) {
      seq++;
      await insertRuntimeEvent(database, {
        id: seq.toString().padStart(26, "0"),
        kind: event.kind,
        occurredAt: seq * 1000,
        payload: event.payload,
        seq,
        sessionId,
      });
    }
    seq++;
    await insertRuntimeEvent(database, {
      id: seq.toString().padStart(26, "0"),
      kind: "thought.completed",
      occurredAt: seq * 1000,
      payload: { thoughtId: `thought-${thought}` },
      seq,
      sessionId,
    });
    if (thought === 0) {
      const body = await history();
      expect(body["truncated"]).toBe(false);
      expect(body["events"]).toMatchObject([{ content: finalText }]);
    }
  }

  const body = await history();
  expect(body["truncated"]).toBe(true);
  expect(body["events"]).toEqual([
    expect.objectContaining({ content: finalText, type: "agent.thinking.delta" }),
  ]);

  const viewerInput = { sessionId, viewerId: PUBLIC_API_TEST_IDS.ownerAccount };
  const viewerState = await loadSessionViewerState(database, viewerInput);
  expect(viewerState.messages).toEqual([
    expect.objectContaining({
      id: "thought-4",
      segments: [{ kind: "reasoning", status: "completed", text: finalText }],
    }),
  ]);
  expect(Buffer.byteLength(JSON.stringify(viewerState))).toBeLessThanOrEqual(
    SESSION_EVENT_WINDOW_MAX_BYTES,
  );
  expect((await loadSessionState(database, viewerInput)).messages).toEqual([]);

  const window = await readSessionEventWindow(database, { rowLimit: 20_000, sessionId });
  expect(window.truncated).toBe(true);
  let afterSeq = window.oldestSeq! - 1;
  let totalBytes = 0;
  let pages = 0;
  while (afterSeq < window.latestSeq!) {
    const rows = await readSessionEventRowsAfterSeq(database, {
      afterSeq,
      sessionId,
      throughSeq: window.latestSeq!,
    });
    expect(rows.length).toBeGreaterThan(0);
    const bytes = Buffer.byteLength(JSON.stringify(rows));
    expect(bytes).toBeLessThanOrEqual(SESSION_EVENT_PAGE_MAX_BYTES);
    totalBytes += bytes;
    pages++;
    afterSeq = rows.at(-1)!.seq;
  }
  expect(pages).toBeGreaterThan(1);
  expect(totalBytes).toBeLessThanOrEqual(SESSION_EVENT_WINDOW_MAX_BYTES);
}, 20_000);

test.each(["history", "stream"] as const)(
  "limits database reads for one %s event from a long history",
  async (mode) => {
    const database = await createPublicHttpContractDatabase();
    const live = createPublicEventSessionNamespace();
    const sessionId = PUBLIC_API_TEST_IDS.ownerSession;
    await insertOwnerSession(database);
    await insertRuntimeEvent(database, {
      kind: "message.added",
      occurredAt: 1000,
      payload: { content: "small", messageId: "message", role: "agent" },
      seq: 1,
      sessionId,
    });
    await database
      .prepare(`
    WITH RECURSIVE indices(value) AS (
      SELECT 2 UNION ALL SELECT value + 1 FROM indices WHERE value < 20000
    )
    INSERT INTO session_event (
      id, session_id, source_event_id, source, seq, event_type, content_text,
      created_at, occurred_at, ended_at, family, process_status, process_type, visibility
    )
    SELECT printf('%026d', value), session_id, printf('%026d', value), source, value,
      event_type, content_text, created_at, occurred_at, ended_at, family,
      process_status, process_type, visibility
    FROM session_event CROSS JOIN indices WHERE seq = 1
  `)
      .run();

    const prepare = spyOn(database, "prepare");
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await requestPublicApi(
        createPublicThreadApiTestApp(),
        database,
        new Request(
          `https://api.example.com/api/v2/threads/${sessionId}/events${mode === "stream" ? "/stream" : ""}?limit=1`,
          {
            headers: { Authorization: bearer(TOKENS.owner) },
          },
        ),
        { sessionNamespace: live.binding },
      );
      expect(response.status).toBe(200);
      const expected = expect.objectContaining({
        id: "00000000000000000000020000",
        content: "small",
      });
      if (mode === "history") {
        const body = await readJson(response);
        expect(body["events"]).toEqual([expected]);
        expect(body["truncated"]).toBe(true);
      } else {
        reader = response.body!.getReader();
        const decoder = new TextDecoder();
        expect(decoder.decode((await reader.read()).value)).toBe(": connected\n\n");
        const event = decoder.decode((await reader.read()).value);
        const data = event.split("\n").find((line) => line.startsWith("data: "));
        expect(JSON.parse(data!.slice(6))).toEqual(expected);
      }
      expect(prepare.mock.calls.length).toBeLessThanOrEqual(20);
    } finally {
      await reader?.cancel();
      prepare.mockRestore();
      live.close();
    }
  },
);
