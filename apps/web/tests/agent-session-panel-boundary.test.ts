import { describe, expect, test } from "bun:test";

import { createLiveStateMessage } from "@mosoo/ag-ui-session";

import { shouldSpeculativelyCreateSessionOnTyping } from "../src/routes/agent/components/agent-session-panel-rules";
import type { SpeculativeSessionCreateInput } from "../src/routes/agent/components/agent-session-panel-rules";
import {
  getResetSessionIds,
  withPendingSend,
} from "../src/routes/agent/components/use-agent-session-panel-model";

describe("agent session panel boundary", () => {
  test("speculatively creates a session on typing only for a ready, empty Preview panel", () => {
    const readyInput: SpeculativeSessionCreateInput = {
      activeSessionId: null,
      projectId: "project_1",
      readinessBlockMessage: null,
      sending: false,
      sessionListLoaded: true,
    };

    expect(shouldSpeculativelyCreateSessionOnTyping(readyInput)).toBe(true);
    expect(shouldSpeculativelyCreateSessionOnTyping({ ...readyInput, projectId: null })).toBe(
      false,
    );
    expect(
      shouldSpeculativelyCreateSessionOnTyping({ ...readyInput, activeSessionId: "session_1" }),
    ).toBe(false);
    expect(
      shouldSpeculativelyCreateSessionOnTyping({ ...readyInput, sessionListLoaded: false }),
    ).toBe(false);
    expect(shouldSpeculativelyCreateSessionOnTyping({ ...readyInput, sending: true })).toBe(false);
    expect(
      shouldSpeculativelyCreateSessionOnTyping({
        ...readyInput,
        readinessBlockMessage: "Provider key required.",
      }),
    ).toBe(false);
  });

  test("shows a send in flight as a user message until the server echo lands", () => {
    const earlier = createLiveStateMessage({ content: "hello", id: "msg_1", role: "user" });
    const reply = createLiveStateMessage({ content: "Hi.", id: "msg_2", role: "assistant" });
    const message = createLiveStateMessage({
      content: "run the tests",
      id: "pending:req_1",
      role: "user",
    });
    const pendingSend = { message, userMessageCount: 1 };
    const transcript = [earlier, reply];

    expect(withPendingSend(transcript, null)).toBe(transcript);
    expect(withPendingSend(transcript, pendingSend)).toEqual([earlier, reply, message]);

    const streamed = [
      ...transcript,
      createLiveStateMessage({ content: "Working on it.", id: "msg_3", role: "assistant" }),
    ];
    expect(withPendingSend(streamed, pendingSend).at(-1)).toBe(message);

    const echoed = [
      ...transcript,
      createLiveStateMessage({ content: "run the tests", id: "msg_3", role: "user" }),
    ];
    expect(withPendingSend(echoed, pendingSend)).toBe(echoed);
  });

  test("resets all known Preview chat sessions instead of falling back to older history", () => {
    expect(
      getResetSessionIds({
        activeSessionId: "session_active",
        sessions: [{ id: "session_old" }, { id: "session_active" }],
      }),
    ).toEqual(["session_old", "session_active"]);
  });
});
