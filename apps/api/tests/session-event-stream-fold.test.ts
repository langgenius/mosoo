import { describe, expect, test } from "bun:test";

import type { RuntimeEventId, SessionRunId } from "@mosoo/id";

import { foldStreamedSessionEventRows } from "../src/modules/sessions/domain/session-event-stream-fold";
import type { StreamFoldableSessionEventRow } from "../src/modules/sessions/domain/session-event-stream-fold";

const RUN_ID = "run-1" as SessionRunId;

function row(input: {
  content: string;
  eventType: string;
  id: string;
  processType?: string;
  runId?: SessionRunId | null;
  seq: number;
}): StreamFoldableSessionEventRow {
  return {
    content_text: input.content,
    ended_at: input.seq * 1000,
    event_type: input.eventType,
    id: input.id as RuntimeEventId,
    occurred_at: input.seq * 1000,
    process_type: input.processType ?? "agent.message.delta",
    run_id: input.runId === undefined ? RUN_ID : input.runId,
    seq: input.seq,
    tokens: null,
  };
}

describe("session event stream folding", () => {
  test("folds a streamed assistant message into one row", () => {
    const folded = foldStreamedSessionEventRows(
      [
        row({ content: "Message updated.", eventType: "message.started", id: "m-start", seq: 1 }),
        row({ content: "你", eventType: "message.delta", id: "m-1", seq: 2 }),
        row({ content: "好", eventType: "message.delta", id: "m-2", seq: 3 }),
        row({ content: "，世界", eventType: "message.delta", id: "m-3", seq: 4 }),
        row({ content: "Message updated.", eventType: "message.completed", id: "m-end", seq: 5 }),
      ],
      { flushOpenStreams: true },
    );

    expect(folded.openStreamRows).toEqual([]);
    expect(folded.rows).toHaveLength(1);
    expect(folded.rows[0]).toMatchObject({
      content_text: "你好，世界",
      event_type: "message.completed",
      id: "m-end",
      occurred_at: 1000,
      seq: 1,
    });
  });

  test("appends repeated delta fragments without deduplicating prefixes", () => {
    const folded = foldStreamedSessionEventRows(
      [
        row({ content: "ha", eventType: "message.delta", id: "m-1", seq: 1 }),
        row({ content: "ha", eventType: "message.delta", id: "m-2", seq: 2 }),
        row({ content: "h", eventType: "message.delta", id: "m-3", seq: 3 }),
        row({ content: "Message updated.", eventType: "message.completed", id: "m-end", seq: 4 }),
      ],
      { flushOpenStreams: true },
    );

    expect(folded.rows.map((entry) => entry.content_text)).toEqual(["hahah"]);
  });

  test("prefers a closing snapshot that extends the streamed prefix", () => {
    const folded = foldStreamedSessionEventRows(
      [
        row({ content: "Final ans", eventType: "message.delta", id: "m-1", seq: 1 }),
        row({ content: "Final answer.", eventType: "message.added", id: "m-added", seq: 2 }),
      ],
      { flushOpenStreams: true },
    );

    expect(folded.rows).toHaveLength(1);
    expect(folded.rows[0]).toMatchObject({
      content_text: "Final answer.",
      id: "m-added",
    });
  });

  test("keeps standalone message.added rows untouched", () => {
    const first = row({ content: "First message.", eventType: "message.added", id: "m-1", seq: 1 });
    const second = row({
      content: "Second message.",
      eventType: "message.added",
      id: "m-2",
      seq: 2,
    });
    const folded = foldStreamedSessionEventRows([first, second], { flushOpenStreams: true });

    expect(folded.rows).toEqual([first, second]);
  });

  test("keeps interleaved non-stream rows and folds around them", () => {
    const toolRow = row({
      content: "Read file",
      eventType: "tool.call.updated",
      id: "t-1",
      processType: "tool.use.started",
      seq: 3,
    });
    const folded = foldStreamedSessionEventRows(
      [
        row({ content: "部分", eventType: "message.delta", id: "m-1", seq: 1 }),
        row({ content: "回答", eventType: "message.delta", id: "m-2", seq: 2 }),
        toolRow,
        row({ content: "。", eventType: "message.delta", id: "m-3", seq: 4 }),
        row({ content: "Message updated.", eventType: "message.completed", id: "m-end", seq: 5 }),
      ],
      { flushOpenStreams: true },
    );

    expect(folded.rows).toHaveLength(2);
    expect(folded.rows[0]).toEqual(toolRow);
    expect(folded.rows[1]).toMatchObject({ content_text: "部分回答。", seq: 1 });
  });

  test("folds message and thought streams independently", () => {
    const folded = foldStreamedSessionEventRows(
      [
        row({
          content: "思考",
          eventType: "thought.delta",
          id: "th-1",
          processType: "agent.thinking.delta",
          seq: 1,
        }),
        row({ content: "回答", eventType: "message.delta", id: "m-1", seq: 2 }),
        row({
          content: "中",
          eventType: "thought.delta",
          id: "th-2",
          processType: "agent.thinking.delta",
          seq: 3,
        }),
        row({
          content: "Agent thinking updated.",
          eventType: "thought.completed",
          id: "th-end",
          processType: "agent.thinking.delta",
          seq: 4,
        }),
        row({ content: "完毕", eventType: "message.delta", id: "m-2", seq: 5 }),
        row({ content: "Message updated.", eventType: "message.completed", id: "m-end", seq: 6 }),
      ],
      { flushOpenStreams: true },
    );

    expect(folded.rows.map((entry) => entry.content_text)).toEqual(["思考中", "回答完毕"]);
  });

  test("flushes interrupted streams when the run reaches a terminal event", () => {
    const failedRow = row({
      content: "Run failed.",
      eventType: "run.failed",
      id: "r-failed",
      processType: "run.failed",
      seq: 3,
    });
    const folded = foldStreamedSessionEventRows(
      [
        row({ content: "写到一", eventType: "message.delta", id: "m-1", seq: 1 }),
        row({ content: "半", eventType: "message.delta", id: "m-2", seq: 2 }),
        failedRow,
      ],
      { flushOpenStreams: false },
    );

    expect(folded.openStreamRows).toEqual([]);
    expect(folded.rows.map((entry) => entry.content_text)).toEqual(["写到一半", "Run failed."]);
  });

  test("closes the previous stream when a new one starts without a completed row", () => {
    const folded = foldStreamedSessionEventRows(
      [
        row({ content: "第一条", eventType: "message.delta", id: "m-1", seq: 1 }),
        row({ content: "Message updated.", eventType: "message.started", id: "m-start", seq: 2 }),
        row({ content: "第二条", eventType: "message.delta", id: "m-2", seq: 3 }),
        row({ content: "Message updated.", eventType: "message.completed", id: "m-end", seq: 4 }),
      ],
      { flushOpenStreams: true },
    );

    expect(folded.rows.map((entry) => entry.content_text)).toEqual(["第一条", "第二条"]);
  });

  test("withholds open streams so callers can carry them across reads", () => {
    const fragments = [
      row({ content: "流式", eventType: "message.delta", id: "m-1", seq: 1 }),
      row({ content: "输出", eventType: "message.delta", id: "m-2", seq: 2 }),
    ];
    const firstFold = foldStreamedSessionEventRows(fragments, { flushOpenStreams: false });

    expect(firstFold.rows).toEqual([]);
    expect(firstFold.openStreamRows).toEqual(fragments);

    const secondFold = foldStreamedSessionEventRows(
      [
        ...firstFold.openStreamRows,
        row({ content: "完成", eventType: "message.delta", id: "m-3", seq: 3 }),
        row({ content: "Message updated.", eventType: "message.completed", id: "m-end", seq: 4 }),
      ],
      { flushOpenStreams: false },
    );

    expect(secondFold.openStreamRows).toEqual([]);
    expect(secondFold.rows).toHaveLength(1);
    expect(secondFold.rows[0]).toMatchObject({ content_text: "流式输出完成", id: "m-end" });
  });

  test("drops streams that never carried text", () => {
    const folded = foldStreamedSessionEventRows(
      [
        row({ content: "Message updated.", eventType: "message.started", id: "m-start", seq: 1 }),
        row({ content: "Message updated.", eventType: "message.completed", id: "m-end", seq: 2 }),
      ],
      { flushOpenStreams: true },
    );

    expect(folded.rows).toEqual([]);
  });

  test("re-folding folded rows is a no-op", () => {
    const folded = foldStreamedSessionEventRows(
      [
        row({ content: "你", eventType: "message.delta", id: "m-1", seq: 1 }),
        row({ content: "好", eventType: "message.delta", id: "m-2", seq: 2 }),
        row({ content: "Message updated.", eventType: "message.completed", id: "m-end", seq: 3 }),
      ],
      { flushOpenStreams: true },
    );
    const refolded = foldStreamedSessionEventRows(folded.rows, { flushOpenStreams: true });

    expect(refolded.rows).toEqual(folded.rows);
  });
});
