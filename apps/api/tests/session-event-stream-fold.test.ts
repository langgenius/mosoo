import { describe, expect, test } from "bun:test";

import type { RuntimeEventId, SessionRunId } from "@mosoo/id";

import {
  createMessageStreamLifecycle,
  findLeftIncompleteSessionEventStreamKeys,
  foldStreamedSessionEventRows,
  reduceMessageStreamLifecycle,
  resolveSealedMessageStream,
} from "../src/modules/sessions/domain/session-event-stream-fold";
import type { StreamFoldableSessionEventRow } from "../src/modules/sessions/domain/session-event-stream-fold";

const RUN_ID = "run-1" as SessionRunId;

interface TestSessionEventRow extends StreamFoldableSessionEventRow {
  process_status: "available" | "error";
}

function row(input: {
  content: string;
  eventType: string;
  id: string;
  processStatus?: TestSessionEventRow["process_status"];
  processType?: string;
  runId?: SessionRunId | null;
  seq: number;
  streamId?: string | null;
}): TestSessionEventRow {
  return {
    content_text: input.content,
    ended_at: input.seq * 1000,
    event_type: input.eventType,
    id: input.id as RuntimeEventId,
    occurred_at: input.seq * 1000,
    process_status: input.processStatus ?? "available",
    process_type: input.processType ?? "agent.message.delta",
    run_id: input.runId === undefined ? RUN_ID : input.runId,
    seq: input.seq,
    stream_id: input.streamId === undefined ? "stream-1" : input.streamId,
    tokens: null,
  };
}

describe("session event stream folding", () => {
  test.each([
    [[], false, false],
    [["message.added"], true, false],
    [["message.added", "message.completed"], true, true],
    [["message.added", "message.completed", "message.delta"], true, false],
    [["message.added", "message.completed", "message.started"], false, false],
    [["message.added", "message.cancelled", "message.completed"], false, false],
    [["message.added", "message.failed", "message.completed"], false, false],
    [["message.started", "message.completed"], false, false],
  ] as const)(
    "reduces message lifecycle %j to authoritative=%s sealed=%s",
    (eventTypes, authoritative, sealed) => {
      let state = createMessageStreamLifecycle();
      for (const eventType of eventTypes) {
        state = reduceMessageStreamLifecycle(state, eventType);
      }
      expect(state).toEqual({ authoritative, sealed });
    },
  );

  test("rejects a streamed row without identity", () => {
    expect(() =>
      foldStreamedSessionEventRows([
        row({
          content: "orphan",
          eventType: "message.delta",
          id: "orphan",
          seq: 1,
          streamId: null,
        }),
      ]),
    ).toThrow("has no stream identity");
  });

  test.each([
    ["message.completed", "available"],
    ["message.cancelled", "available"],
    ["message.failed", "error"],
  ] as const)("folds a streamed assistant message closed by %s", (eventType, processStatus) => {
    const folded = foldStreamedSessionEventRows([
      row({ content: "Partial ", eventType: "message.delta", id: "m-1", seq: 1 }),
      row({ content: "answer", eventType: "message.delta", id: "m-2", seq: 2 }),
      row({
        content: "Message updated.",
        eventType,
        id: "m-end",
        processStatus,
        seq: 3,
      }),
    ]);

    expect(folded).toEqual([
      expect.objectContaining({
        content_text: "Partial answer",
        event_type: eventType,
        id: "m-end",
        process_status: processStatus,
        seq: 1,
      }),
    ]);
  });

  test("folds a cancelled thought stream", () => {
    const folded = foldStreamedSessionEventRows([
      row({
        content: "Inspect",
        eventType: "thought.delta",
        id: "th-1",
        processType: "agent.thinking.delta",
        seq: 1,
      }),
      row({
        content: "Agent thinking updated.",
        eventType: "thought.cancelled",
        id: "th-end",
        processType: "agent.thinking.delta",
        seq: 2,
      }),
    ]);

    expect(folded).toEqual([
      expect.objectContaining({ content_text: "Inspect", event_type: "thought.cancelled" }),
    ]);
  });

  test("appends deltas after an authoritative message snapshot", () => {
    const folded = foldStreamedSessionEventRows([
      row({ content: "Final ", eventType: "message.added", id: "m-added", seq: 1 }),
      row({ content: "answer.", eventType: "message.delta", id: "m-delta", seq: 2 }),
      row({ content: "Message updated.", eventType: "message.completed", id: "m-end", seq: 3 }),
    ]);

    expect(folded).toEqual([
      expect.objectContaining({ content_text: "Final answer.", id: "m-end" }),
    ]);
  });

  test("appends repeated delta fragments without prefix guessing", () => {
    const folded = foldStreamedSessionEventRows([
      row({ content: "ha", eventType: "message.delta", id: "m-1", seq: 1 }),
      row({ content: "ha", eventType: "message.delta", id: "m-2", seq: 2 }),
      row({ content: "h", eventType: "message.delta", id: "m-3", seq: 3 }),
      row({ content: "Message updated.", eventType: "message.completed", id: "m-end", seq: 4 }),
    ]);

    expect(folded.map((entry) => entry.content_text)).toEqual(["hahah"]);
  });

  test("keeps standalone snapshots for distinct identities", () => {
    const first = row({
      content: "First message.",
      eventType: "message.added",
      id: "m-1",
      seq: 1,
      streamId: "message-1",
    });
    const second = row({
      content: "Second message.",
      eventType: "message.added",
      id: "m-2",
      seq: 2,
      streamId: "message-2",
    });

    expect(foldStreamedSessionEventRows([first, second])).toEqual([first, second]);
  });

  test("treats an authoritative snapshot as a complete reverse-scan boundary", () => {
    expect(
      findLeftIncompleteSessionEventStreamKeys([
        row({ content: "Complete snapshot", eventType: "message.added", id: "m-1", seq: 1 }),
      ]),
    ).toEqual(new Set());
  });

  test("keeps timeline order around interleaved non-stream rows", () => {
    const toolRow = row({
      content: "Read file",
      eventType: "tool.call.updated",
      id: "t-1",
      processType: "tool.use.started",
      seq: 3,
    });
    const folded = foldStreamedSessionEventRows([
      row({ content: "部分", eventType: "message.delta", id: "m-1", seq: 1 }),
      row({ content: "回答", eventType: "message.delta", id: "m-2", seq: 2 }),
      toolRow,
      row({ content: "。", eventType: "message.delta", id: "m-3", seq: 4 }),
      row({ content: "Message updated.", eventType: "message.completed", id: "m-end", seq: 5 }),
    ]);

    expect(folded).toHaveLength(2);
    expect(folded[0]).toMatchObject({ content_text: "部分回答。", seq: 1 });
    expect(folded[1]).toEqual(toolRow);
  });

  test("separates message and thought streams with the same identity", () => {
    const folded = foldStreamedSessionEventRows([
      row({
        content: "思考",
        eventType: "thought.delta",
        id: "th-1",
        processType: "agent.thinking.delta",
        seq: 1,
      }),
      row({ content: "回答", eventType: "message.delta", id: "m-1", seq: 2 }),
      row({
        content: "Agent thinking updated.",
        eventType: "thought.completed",
        id: "th-end",
        processType: "agent.thinking.delta",
        seq: 3,
      }),
      row({ content: "Message updated.", eventType: "message.completed", id: "m-end", seq: 4 }),
    ]);

    expect(folded.map((entry) => entry.content_text)).toEqual(["思考", "回答"]);
  });

  test("separates user and assistant messages with the same stream identity", () => {
    const folded = foldStreamedSessionEventRows([
      row({
        content: "User",
        eventType: "message.delta",
        id: "user-delta",
        processType: "user.message",
        seq: 1,
      }),
      row({ content: "Assistant", eventType: "message.delta", id: "agent-delta", seq: 2 }),
      row({
        content: "Message updated.",
        eventType: "message.completed",
        id: "user-end",
        processType: "user.message",
        seq: 3,
      }),
      row({
        content: "Message updated.",
        eventType: "message.completed",
        id: "agent-end",
        seq: 4,
      }),
    ]);

    expect(folded.map((entry) => [entry.process_type, entry.content_text])).toEqual([
      ["user.message", "User"],
      ["agent.message.delta", "Assistant"],
    ]);
  });

  test("separates the same stream identity across runs", () => {
    const folded = foldStreamedSessionEventRows([
      row({ content: "run one", eventType: "message.delta", id: "r1-delta", seq: 1 }),
      row({
        content: "run two",
        eventType: "message.delta",
        id: "r2-delta",
        runId: "run-2" as SessionRunId,
        seq: 2,
      }),
      row({
        content: "Message updated.",
        eventType: "message.completed",
        id: "r2-end",
        runId: "run-2" as SessionRunId,
        seq: 3,
      }),
      row({ content: "Message updated.", eventType: "message.completed", id: "r1-end", seq: 4 }),
    ]);

    expect(folded.map((entry) => entry.content_text)).toEqual(["run one", "run two"]);
  });

  test("flushes interrupted streams when their run terminates", () => {
    const failedRow = row({
      content: "Run failed.",
      eventType: "run.failed",
      id: "r-failed",
      processType: "run.failed",
      seq: 3,
    });
    const folded = foldStreamedSessionEventRows([
      row({ content: "写到一", eventType: "message.delta", id: "m-1", seq: 1 }),
      row({ content: "半", eventType: "message.delta", id: "m-2", seq: 2 }),
      failedRow,
    ]);

    expect(folded.map((entry) => entry.content_text)).toEqual(["写到一半", "Run failed."]);
  });

  test("reconciles lossless message rows persisted after a repaired run terminal", () => {
    const folded = foldStreamedSessionEventRows([
      row({ content: "Message updated.", eventType: "message.started", id: "m-start", seq: 1 }),
      row({ content: "Draft", eventType: "message.delta", id: "m-delta", seq: 2 }),
      row({ content: "Run failed.", eventType: "run.failed", id: "run-failed", seq: 3 }),
      row({ content: "Final ", eventType: "message.added", id: "m-added", seq: 4 }),
      row({ content: "world", eventType: "message.delta", id: "m-late", seq: 5 }),
    ]);

    expect(folded.map((entry) => entry.content_text)).toEqual(["Final world", "Run failed."]);
  });

  test("uses a trailing authoritative snapshot without replacing the terminal row", () => {
    const folded = foldStreamedSessionEventRows([
      row({ content: "Message updated.", eventType: "message.started", id: "m-start", seq: 1 }),
      row({ content: "corrupt preview", eventType: "message.delta", id: "m-delta", seq: 2 }),
      row({ content: "Message updated.", eventType: "message.completed", id: "m-end", seq: 3 }),
      row({
        content: "Authoritative answer.",
        eventType: "message.added",
        id: "m-added",
        seq: 4,
      }),
    ]);

    expect(folded).toEqual([
      expect.objectContaining({
        content_text: "Authoritative answer.",
        event_type: "message.completed",
        id: "m-end",
        seq: 1,
      }),
    ]);
  });

  test("folds interleaved message streams by identity", () => {
    const folded = foldStreamedSessionEventRows([
      row({ content: "A1", eventType: "message.delta", id: "a-1", seq: 1, streamId: "a" }),
      row({ content: "B1", eventType: "message.delta", id: "b-1", seq: 2, streamId: "b" }),
      row({ content: "A2", eventType: "message.delta", id: "a-2", seq: 3, streamId: "a" }),
      row({
        content: "Message updated.",
        eventType: "message.completed",
        id: "b-end",
        seq: 4,
        streamId: "b",
      }),
      row({
        content: "Message updated.",
        eventType: "message.completed",
        id: "a-end",
        seq: 5,
        streamId: "a",
      }),
    ]);

    expect(
      Object.fromEntries(folded.map((entry) => [entry.stream_id, entry.content_text])),
    ).toEqual({
      a: "A1A2",
      b: "B1",
    });
  });

  test("keeps a snapshot for a different identity as its own message", () => {
    const folded = foldStreamedSessionEventRows([
      row({
        content: "第一条进度",
        eventType: "message.delta",
        id: "m-1",
        seq: 1,
        streamId: "message-1",
      }),
      row({
        content: "Message updated.",
        eventType: "message.completed",
        id: "m-end",
        seq: 2,
        streamId: "message-1",
      }),
      row({
        content: "另一条最终回复",
        eventType: "message.added",
        id: "m-added",
        seq: 3,
        streamId: "message-2",
      }),
    ]);

    expect(folded.map((entry) => entry.content_text)).toEqual(["第一条进度", "另一条最终回复"]);
  });

  test("associates trailing snapshots with their stream in a multi-message turn", () => {
    const folded = foldStreamedSessionEventRows([
      row({ content: "进度", eventType: "message.delta", id: "m-1", seq: 1, streamId: "one" }),
      row({
        content: "Message updated.",
        eventType: "message.completed",
        id: "c-1",
        seq: 2,
        streamId: "one",
      }),
      row({ content: "进度说明", eventType: "message.added", id: "a-1", seq: 3, streamId: "one" }),
      row({ content: "最终", eventType: "message.delta", id: "m-2", seq: 4, streamId: "two" }),
      row({
        content: "Message updated.",
        eventType: "message.completed",
        id: "c-2",
        seq: 5,
        streamId: "two",
      }),
      row({ content: "最终回复", eventType: "message.added", id: "a-2", seq: 6, streamId: "two" }),
    ]);

    expect(folded.map((entry) => entry.content_text)).toEqual(["进度说明", "最终回复"]);
    expect(folded.map((entry) => entry.id)).toEqual(["c-1", "c-2"]);
  });

  test("keeps a terminal stream row with empty content", () => {
    const folded = foldStreamedSessionEventRows([
      row({ content: "Message updated.", eventType: "message.started", id: "m-start", seq: 1 }),
      row({ content: "Message updated.", eventType: "message.completed", id: "m-end", seq: 2 }),
    ]);

    expect(folded).toEqual([
      expect.objectContaining({ content_text: "", event_type: "message.completed", id: "m-end" }),
    ]);
  });

  test("re-folding folded rows is a no-op", () => {
    const folded = foldStreamedSessionEventRows([
      row({ content: "你", eventType: "message.delta", id: "m-1", seq: 1 }),
      row({ content: "好", eventType: "message.delta", id: "m-2", seq: 2 }),
      row({ content: "Message updated.", eventType: "message.completed", id: "m-end", seq: 3 }),
    ]);

    expect(foldStreamedSessionEventRows(folded)).toEqual(folded);
  });

  test("resolves only the latest sealed authoritative message snapshot", () => {
    const firstCompletion = [
      row({ content: "Draft", eventType: "message.added", id: "m-draft", seq: 1 }),
      row({ content: "Message updated.", eventType: "message.completed", id: "m-end-1", seq: 2 }),
    ];
    const replacement = [
      ...firstCompletion,
      row({ content: "Final ", eventType: "message.added", id: "m-added", seq: 3 }),
      row({ content: "answer", eventType: "message.delta", id: "m-final", seq: 4 }),
    ];

    expect(resolveSealedMessageStream(firstCompletion)).toEqual({ text: "Draft" });
    expect(resolveSealedMessageStream(replacement)).toBeNull();
    expect(
      resolveSealedMessageStream([
        ...replacement,
        row({
          content: "Message updated.",
          eventType: "message.completed",
          id: "m-end-2",
          seq: 5,
        }),
      ]),
    ).toEqual({ text: "Final answer" });
  });

  test("does not treat failed, cancelled, or restarted messages as sealed final output", () => {
    for (const eventType of ["message.failed", "message.cancelled"] as const) {
      expect(
        resolveSealedMessageStream([
          row({ content: "partial", eventType: "message.delta", id: "m-delta", seq: 1 }),
          row({ content: "Message updated.", eventType, id: "m-terminal", seq: 2 }),
        ]),
      ).toBeNull();
    }

    expect(
      resolveSealedMessageStream([
        row({ content: "old", eventType: "message.added", id: "m-delta", seq: 1 }),
        row({
          content: "Message updated.",
          eventType: "message.completed",
          id: "m-terminal",
          seq: 2,
        }),
        row({ content: "Message updated.", eventType: "message.started", id: "m-restart", seq: 3 }),
      ]),
    ).toBeNull();

    expect(
      resolveSealedMessageStream([
        row({ content: "Message updated.", eventType: "message.started", id: "m-start", seq: 1 }),
        row({ content: "best effort", eventType: "message.delta", id: "m-delta", seq: 2 }),
        row({
          content: "Message updated.",
          eventType: "message.completed",
          id: "m-terminal",
          seq: 3,
        }),
      ]),
    ).toBeNull();

    expect(
      resolveSealedMessageStream([
        row({ content: "old", eventType: "message.added", id: "m-added", seq: 1 }),
        row({ content: "Message updated.", eventType: "message.failed", id: "m-failed", seq: 2 }),
        row({
          content: "Message updated.",
          eventType: "message.completed",
          id: "m-terminal",
          seq: 3,
        }),
      ]),
    ).toBeNull();
  });
});
