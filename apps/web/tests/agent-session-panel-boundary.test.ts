import { describe, expect, test } from "bun:test";

import type { AgentReadiness } from "@mosoo/contracts/agent";

import {
  getSessionControlMode,
  selectSessionPanelReadiness,
  shouldSpeculativelyCreateSessionOnTyping,
  shouldWaitForRuntimeReadyOnNewSession,
} from "../src/routes/agent/components/agent-session-panel-rules";
import type { SpeculativeSessionCreateInput } from "../src/routes/agent/components/agent-session-panel-rules";
import {
  getResetSessionIds,
  removeSessionConfigurationRevisionKeys,
} from "../src/routes/agent/components/use-agent-session-panel-model";

function readiness(overrides: Partial<AgentReadiness>): AgentReadiness {
  return {
    checkedAt: "2026-06-23T00:00:00.000Z",
    issues: [],
    ready: true,
    ...overrides,
  };
}

describe("agent session panel boundary", () => {
  test("uses latest ready agent readiness over a stale blocking stream snapshot", () => {
    const staleStreamReadiness = readiness({
      checkedAt: "2026-06-23T00:00:00.000Z",
      issues: [
        {
          code: "agent.readiness.provider_credential.missing",
          message: "Provider key required.",
          severity: "error",
        },
      ],
      ready: false,
    });
    const latestAgentReadiness = readiness({
      checkedAt: "2026-06-23T00:01:00.000Z",
      ready: true,
    });

    expect(
      selectSessionPanelReadiness({
        agentReadiness: latestAgentReadiness,
        streamReadiness: staleStreamReadiness,
      }),
    ).toBe(latestAgentReadiness);
  });

  test("only Preview New Session opts into runtime readiness wait", () => {
    expect(
      shouldWaitForRuntimeReadyOnNewSession({
        sessionType: "preview",
        waitForRuntimeReadyOnNewSession: true,
      }),
    ).toBe(true);
    expect(
      shouldWaitForRuntimeReadyOnNewSession({
        sessionType: "ui",
        waitForRuntimeReadyOnNewSession: true,
      }),
    ).toBe(false);
    expect(
      shouldWaitForRuntimeReadyOnNewSession({
        sessionType: "preview",
        waitForRuntimeReadyOnNewSession: false,
      }),
    ).toBe(false);
  });

  test("speculatively creates a session on typing only for a ready, empty Preview panel", () => {
    const readyInput: SpeculativeSessionCreateInput = {
      activeSessionId: null,
      appId: "app_1",
      readinessBlockMessage: null,
      sending: false,
      sessionListLoaded: true,
      sessionType: "preview",
    };

    expect(shouldSpeculativelyCreateSessionOnTyping(readyInput)).toBe(true);
    expect(shouldSpeculativelyCreateSessionOnTyping({ ...readyInput, sessionType: "ui" })).toBe(
      false,
    );
    expect(shouldSpeculativelyCreateSessionOnTyping({ ...readyInput, appId: null })).toBe(false);
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

  test("uses Reset chat instead of New session in Preview mode", () => {
    expect(getSessionControlMode("preview")).toBe("reset");
    expect(getSessionControlMode("consume")).toBe("new_session");
  });

  test("resets all known Preview chat sessions instead of falling back to older history", () => {
    expect(
      getResetSessionIds({
        activeSessionId: "session_active",
        sessionType: "preview",
        sessions: [{ id: "session_old" }, { id: "session_active" }],
      }),
    ).toEqual(["session_old", "session_active"]);
    expect(
      removeSessionConfigurationRevisionKeys(
        {
          session_active: "rev-active",
          session_keep: "rev-keep",
          session_old: "rev-old",
        },
        ["session_old", "session_active"],
      ),
    ).toEqual({ session_keep: "rev-keep" });
  });

  test("resets only the active session outside Preview mode", () => {
    expect(
      getResetSessionIds({
        activeSessionId: "session_active",
        sessionType: "ui",
        sessions: [{ id: "session_old" }, { id: "session_active" }],
      }),
    ).toEqual(["session_active"]);
  });
});
