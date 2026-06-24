import { describe, expect, test } from "bun:test";

import { fromThreadMessageLike } from "@assistant-ui/react";
import type { SessionViewMessage, SessionViewSegment } from "@mosoo/ag-ui-session";

import { convertSessionMessage } from "../src/features/session-chat/assistant-ui/convert-session-message";

const completeStatus = { reason: "unknown", type: "complete" } as const;

function assistantMessage(segments: SessionViewSegment[]): SessionViewMessage {
  return { content: "", createdAt: "", id: "m1", plan: [], role: "assistant", segments };
}

describe("convertSessionMessage", () => {
  test("user message converts to plain string content accepted by assistant-ui", () => {
    const like = convertSessionMessage({
      content: "hello @docs/readme.md",
      createdAt: "",
      id: "u1",
      plan: [],
      role: "user",
      segments: [],
    });

    expect(like.role).toBe("user");
    expect(like.content).toBe("hello @docs/readme.md");

    const message = fromThreadMessageLike(like, "u1", completeStatus);
    expect(message.role).toBe("user");
  });

  test("merges consecutive text segments into one markdown part", () => {
    const like = convertSessionMessage(
      assistantMessage([
        { kind: "text", text: "Hello " },
        { kind: "text", text: "world" },
      ]),
    );

    expect(like.content).toEqual([{ text: "Hello world", type: "text" }]);
  });

  test("pairs tool_use with tool_result and preserves path/args/result", () => {
    const like = convertSessionMessage(
      assistantMessage([
        { kind: "text", text: "running" },
        {
          argsText: '{"q":1}',
          kind: "tool_use",
          path: "src/a.ts",
          tool: "read_file",
          toolCallId: "t1",
        },
        { kind: "tool_result", output: "file body", tool: "read_file", toolCallId: "t1" },
      ]),
    );

    const content = like.content as ReadonlyArray<Record<string, unknown>>;
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ text: "running", type: "text" });
    expect(content[1]).toMatchObject({
      args: { path: "src/a.ts" },
      argsText: '{"q":1}',
      result: "file body",
      toolCallId: "t1",
      toolName: "read_file",
      type: "tool-call",
    });

    // The critical runtime contract: assistant-ui's own normalizer must accept it.
    const message = fromThreadMessageLike(like, "m1", completeStatus);
    const toolPart = message.content.find((part) => part.type === "tool-call");
    expect(toolPart).toBeDefined();
  });

  test("tool_use without a result stays unresolved (renders as running)", () => {
    const like = convertSessionMessage(
      assistantMessage([
        { argsText: "", kind: "tool_use", path: null, tool: "bash", toolCallId: "t2" },
      ]),
    );

    const content = like.content as ReadonlyArray<Record<string, unknown>>;
    expect(content[0]).toMatchObject({ toolCallId: "t2", toolName: "bash", type: "tool-call" });
    expect(content[0]?.result).toBeUndefined();

    const message = fromThreadMessageLike(like, "m1", completeStatus);
    expect(message.content.some((part) => part.type === "tool-call")).toBe(true);
  });

  test("falls back to message.content when a hydrated turn keeps prose only in content", () => {
    // Regression: a reloaded turn can carry its tool calls in `segments` but its
    // prose only in `content`. Without the fallback the text silently vanished.
    const like = convertSessionMessage({
      content: "已完成！我写了一篇 300 字的小作文。",
      createdAt: "",
      id: "m2",
      plan: [],
      role: "assistant",
      segments: [
        {
          argsText: "{}",
          kind: "tool_use",
          path: "outputs/a.txt",
          tool: "Write",
          toolCallId: "w1",
        },
        { kind: "tool_result", output: "ok", tool: "Write", toolCallId: "w1" },
      ],
    });

    const content = like.content as ReadonlyArray<Record<string, unknown>>;
    expect(content.some((part) => part.type === "tool-call")).toBe(true);
    expect(
      content.some(
        (part) => part.type === "text" && part.text === "已完成！我写了一篇 300 字的小作文。",
      ),
    ).toBe(true);

    const message = fromThreadMessageLike(like, "m2", completeStatus);
    expect(message.content.some((part) => part.type === "text")).toBe(true);
  });

  test("renders content for an assistant turn with no segments at all", () => {
    const like = convertSessionMessage({
      content: "plain hydrated answer",
      createdAt: "",
      id: "m3",
      plan: [],
      role: "assistant",
      segments: [],
    });

    expect(like.content).toEqual([{ text: "plain hydrated answer", type: "text" }]);
  });

  test("does not duplicate prose when segments already carry the text", () => {
    const like = convertSessionMessage({
      content: "hello world",
      createdAt: "",
      id: "m4",
      plan: [],
      role: "assistant",
      segments: [{ kind: "text", text: "hello world" }],
    });

    expect(like.content).toEqual([{ text: "hello world", type: "text" }]);
  });
});
