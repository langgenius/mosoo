import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";

import type { AgentReadiness } from "@mosoo/contracts/agent";
import type { SessionSummary, SessionType } from "@mosoo/contracts/session";
import { createPlatformId } from "@mosoo/id";
import type { SessionId } from "@mosoo/id";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { act } from "react";

import type { AgentSessionPanelModel } from "../src/routes/agent/components/agent-session-panel-model-types";

if (process.env.MOSOO_TEST_PREVIEW_PANEL !== "1") {
  test("Preview replacement preserves input and coalesces concurrent actions in the actual panel model", async () => {
    // Bun module mocks are process-global; keep transport fixtures out of other Web tests.
    const child = Bun.spawn({
      cmd: [process.execPath, "test", import.meta.path],
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...process.env, MOSOO_TEST_PREVIEW_PANEL: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (status !== 0) throw new Error(`${stdout}${stderr}`);
    expect(status).toBe(0);
  }, 15_000);
} else {
  const PROJECT = "01J00000000000000000000009";
  const AGENT = "01J0000000000000000000000A";
  const OLD = createPlatformId<SessionId>();
  let sessionType: SessionType = "preview";
  let configurationChangedAt: string | null = null;
  let readiness: AgentReadiness | null = null;
  const makeSession = (id: SessionId): SessionSummary => ({
    agentId: AGENT,
    projectId: PROJECT,
    id,
    archivedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deploymentVersionId: null,
    deploymentVersionNumber: null,
    kind: "cattle",
    lastRun: null,
    lastMessageAt: null,
    model: "test",
    provider: "openai",
    runtimeId: "openai-runtime",
    status: "IDLE",
    title: null,
    type: sessionType,
  });
  let sessions = [makeSession(OLD)];
  let offPageSession: SessionSummary | null = null;
  let creates = 0;
  let listFailure = false;
  const sent: { sessionId: string; text: string }[] = [];
  const noOp = async () => {};

  mock.module("@/domains/session/api/agent-session", () => ({
    listAgentSessions: async (
      _projectId: string,
      _agentId: string,
      options: { sessionId?: string },
    ) => {
      if (listFailure) throw new Error("Preview list offline");
      if (options.sessionId !== undefined) {
        return [...sessions, ...(offPageSession === null ? [] : [offPageSession])].filter(
          (session) => session.id === options.sessionId,
        );
      }
      return sessions;
    },
    createAgentSession: async () => {
      creates += 1;
      const created = makeSession(createPlatformId<SessionId>());
      sessions = [created];
      return created;
    },
    triggerAgentSessionPrewarm: noOp,
  }));
  mock.module("@/domains/session/api/mutations", () => ({
    autoTitleSession: noOp,
    deleteAgentSession: noOp,
  }));
  mock.module("@/shared/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
  mock.module("@/features/session-chat/use-session-chat-layout-state", () => ({
    useSessionChatLayoutState: () => ({
      fileInputRef: { current: null },
      inputRef: { current: null },
      messagesEndRef: { current: null },
    }),
  }));
  mock.module("@/domains/runtime/use-session-stream", () => ({
    useSessionStream: () => ({
      hydrated: true,
      lifecycle: "IDLE",
      messages: [],
      permissionRequests: [],
      readiness: null,
      reconnecting: false,
      streaming: false,
      run: { id: null },
      sendUserMessage: async (input: { sessionId: string; text: string }) => {
        sent.push(input);
      },
      sendPermissionDecision: noOp,
      sendUserInterrupt: noOp,
    }),
  }));

  test("existing, expired, failed lookup, repeated expiry and formal Session actions", async () => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", {
      url: "http://localhost/agent",
    });
    Object.defineProperties(globalThis, {
      window: { configurable: true, value: dom.window },
      document: { configurable: true, value: dom.window.document },
      navigator: { configurable: true, value: dom.window.navigator },
      IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
    });
    const { createRoot } = await import("react-dom/client");
    const { useAgentSessionPanelModel } =
      await import("../src/routes/agent/components/use-agent-session-panel-model");
    let currentModel: AgentSessionPanelModel | null = null;
    function model() {
      if (currentModel === null) throw new Error("Panel has not rendered");
      return currentModel;
    }
    function Harness() {
      currentModel = useAgentSessionPanelModel({
        agentId: AGENT,
        projectId: PROJECT,
        sessionType,
        configurationChangedAt,
        configurationRevisionKey: null,
        readiness,
        requireFreshConfiguration: true,
        waitForRuntimeReadyOnNewSession: false,
      });
      return <div data-session={currentModel.activeSessionId}>{currentModel.input}</div>;
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const element = dom.window.document.getElementById("root")!;
    const root = createRoot(element);
    const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 20));
    const render = async (key = "preview") => {
      await act(async () => {
        root.render(
          <QueryClientProvider client={client}>
            <Harness key={key} />
          </QueryClientProvider>,
        );
      });
      await act(tick);
    };
    try {
      await render();
      expect(model().activeSessionId).toBe(OLD);
      await act(async () => {
        expect(await model().ensureActiveSession()).toBe(OLD);
      });
      expect(creates).toBe(0);
      configurationChangedAt = new Date(Date.now() + 60_000).toISOString();
      readiness = {
        checkedAt: configurationChangedAt,
        issues: [
          { code: "provider_missing", message: "New preset has no provider", severity: "error" },
        ],
        ready: false,
      };
      await render();
      expect(model().configurationRefreshRequired).toBe(true);
      expect(model().readinessBlockMessage).toBeNull();
      await act(async () => {
        expect(await model().handleSend({ text: "Continue the original configuration" })).toBe(
          true,
        );
      });
      expect(sent).toEqual([
        expect.objectContaining({ sessionId: OLD, text: "Continue the original configuration" }),
      ]);
      expect(creates).toBe(0);
      configurationChangedAt = null;
      readiness = null;
      await render();
      await act(async () => {
        model().setInput("Keep this new request");
      });
      sessions = [];
      let replaced: string[] = [];
      await act(async () => {
        replaced = await Promise.all([
          model().ensureActiveSession(),
          model().ensureActiveSession(),
        ]);
      });
      await act(tick);
      expect(replaced[0]).not.toBe(OLD);
      expect(replaced[0]).toBe(replaced[1]);
      expect(creates).toBe(1);
      expect(model().input).toBe("Keep this new request");
      expect(element.textContent).toBe("Keep this new request");
      expect(model().activeSessionId).toBe(replaced[0]);

      listFailure = true;
      await act(async () => {
        await expect(model().ensureActiveSession()).rejects.toThrow("Preview list offline");
      });
      expect(creates).toBe(1);
      expect(model().input).toBe("Keep this new request");
      listFailure = false;
      await act(async () => {
        expect(await model().handleSend({ text: "New work" })).toBe(true);
      });
      expect(sent).toHaveLength(2);
      expect(sent[1]).toMatchObject({ sessionId: replaced[0], text: "New work" });

      offPageSession = sessions[0] ?? null;
      sessions = [];
      await act(async () => {
        await client.invalidateQueries({ queryKey: ["agent-session-list"] });
        await tick();
      });
      expect(model().activeSessionId).toBe(replaced[0]);
      await act(async () => {
        expect(await model().ensureActiveSession()).toBe(replaced[0]);
      });
      expect(creates).toBe(1);
      offPageSession = null;
      sessions = [];
      await act(async () => {
        await client.invalidateQueries({ queryKey: ["agent-session-list"] });
        await tick();
      });
      expect(model().activeSessionId).toBeNull();
      await act(async () => {
        expect(await model().ensureActiveSession()).not.toBe(replaced[0]);
      });
      await act(tick);
      expect(creates).toBe(2);

      sessionType = "ui";
      sessions = [];
      await render("formal");
      await act(async () => {
        await model().handleStartNewSession();
      });
      await act(tick);
      const formalId = model().activeSessionId;
      expect(creates).toBe(3);
      sessions = [];
      await act(async () => {
        await client.invalidateQueries({ queryKey: ["agent-session-list"] });
        await tick();
      });
      expect(model().activeSessionId).toBe(formalId);
      await act(async () => {
        expect(await model().ensureActiveSession()).toBe(formalId!);
      });
      expect(creates).toBe(3);
    } finally {
      await act(async () => {
        root.unmount();
      });
      client.clear();
      dom.window.close();
    }
  });
}
