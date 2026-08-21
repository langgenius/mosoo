import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import type { AgentReadiness } from "@mosoo/contracts/agent";

import {
  selectSessionPanelReadiness,
  shouldSpeculativelyCreateSessionOnTyping,
  shouldWaitForRuntimeReadyOnNewSession,
} from "../src/routes/agent/components/agent-session-panel-rules";
import type { SpeculativeSessionCreateInput } from "../src/routes/agent/components/agent-session-panel-rules";

function readiness(overrides: Partial<AgentReadiness>): AgentReadiness {
  return {
    checkedAt: "2026-06-23T00:00:00.000Z",
    issues: [],
    ready: true,
    ...overrides,
  };
}

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
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

  test("starts a new Preview session without exposing reset behavior", () => {
    const panel = readSource("../src/routes/agent/components/agent-session-panel.tsx");
    const header = readSource("../src/routes/agent/components/agent-session-panel-header.tsx");
    const model = readSource("../src/routes/agent/components/use-agent-session-panel-model.ts");

    expect(panel).toContain("model.handleStartNewSession");
    expect(panel).not.toContain("handleResetSession");
    expect(header).toContain('t("agent.newSession")');
    expect(header).not.toContain("resetChat");
    expect(model).not.toContain("getResetSessionIds");
  });
});
