import { describe, expect, test } from "bun:test";

import type { SessionViewMessage } from "@mosoo/ag-ui-session";

import {
  createPendingSendMessage,
  mergePendingSendMessages,
  PENDING_SEND_TTL_MS,
  prunePendingSends,
  prunePendingSendsForSession,
} from "../src/routes/agent/components/agent-session-pending-sends";
import type { PendingSend } from "../src/routes/agent/components/agent-session-pending-sends";

function message(overrides: Partial<SessionViewMessage>): SessionViewMessage {
  return {
    content: "hello",
    createdAt: "2026-07-17T00:00:00.000Z",
    id: "msg_1",
    plan: [],
    role: "user",
    segments: [],
    ...overrides,
  };
}

function pendingSend(overrides: Partial<PendingSend>): PendingSend {
  return {
    baselineUserMessageIds: [],
    clientRequestId: "req_1",
    createdAtMs: 1_000,
    sessionId: null,
    text: "hello",
    ...overrides,
  };
}

describe("agent session pending sends", () => {
  test("merges the pending user bubble after server messages", () => {
    const serverMessages = [message({ id: "msg_1", role: "assistant" })];
    const merged = mergePendingSendMessages(serverMessages, [
      createPendingSendMessage(pendingSend({ clientRequestId: "req_a", text: "run the tests" })),
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[1]).toMatchObject({
      content: "run the tests",
      id: "pending:req_a",
      role: "user",
    });
  });

  test("returns the same array reference when there are no pending sends", () => {
    const serverMessages = [message({})];

    expect(mergePendingSendMessages(serverMessages, [])).toBe(serverMessages);
  });

  test("prunes an entry when its echo arrives as a new user message", () => {
    const pending = [pendingSend({ baselineUserMessageIds: ["msg_old"], text: "hello " })];
    const messages = [message({ content: "hello", id: "msg_new", role: "user" })];

    expect(prunePendingSends(pending, messages, 2_000)).toHaveLength(0);
  });

  test("keeps the entry when only a baseline message matches the same text", () => {
    const pending = [pendingSend({ baselineUserMessageIds: ["msg_old"], text: "hello" })];
    const messages = [message({ content: "hello", id: "msg_old", role: "user" })];

    expect(prunePendingSends(pending, messages, 2_000)).toBe(pending);
  });

  test("prunes only when a same-text message is newer than the baseline", () => {
    const pending = [
      pendingSend({ baselineUserMessageIds: ["msg_old", "msg_other"], text: "hello" }),
    ];
    const messages = [
      message({ content: "hello", id: "msg_old", role: "user" }),
      message({ content: "hello", id: "msg_new", role: "user" }),
    ];

    expect(prunePendingSends(pending, messages, 2_000)).toHaveLength(0);
  });

  test("ignores assistant messages with matching content", () => {
    const pending = [pendingSend({ text: "hello" })];
    const messages = [message({ content: "hello", id: "msg_new", role: "assistant" })];

    expect(prunePendingSends(pending, messages, 2_000)).toBe(pending);
  });

  test("prunes entries past the TTL even without a matching echo", () => {
    const pending = [pendingSend({ createdAtMs: 1_000 })];

    expect(prunePendingSends(pending, [], 1_000 + PENDING_SEND_TTL_MS)).toHaveLength(0);
    expect(prunePendingSends(pending, [], 1_000 + PENDING_SEND_TTL_MS - 1)).toBe(pending);
  });

  test("session prune keeps unbound entries and drops foreign-session entries", () => {
    const pending = [
      pendingSend({ clientRequestId: "req_unbound", sessionId: null }),
      pendingSend({ clientRequestId: "req_mine", sessionId: "session_a" }),
      pendingSend({ clientRequestId: "req_foreign", sessionId: "session_b" }),
    ];

    const remaining = prunePendingSendsForSession(pending, "session_a");

    expect(remaining.map((entry) => entry.clientRequestId)).toEqual(["req_unbound", "req_mine"]);
    expect(prunePendingSendsForSession(pending, "session_b")).not.toBe(pending);
    expect(
      prunePendingSendsForSession([pendingSend({ sessionId: "session_a" })], "session_a"),
    ).toHaveLength(1);
  });
});
