import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";

import type { AgentReadiness } from "@mosoo/contracts/agent";
import type { SessionSummary } from "@mosoo/contracts/session";
import { createPlatformId } from "@mosoo/id";
import type { SessionId } from "@mosoo/id";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { act } from "react";

import type { AgentSessionPanelModel } from "../src/routes/agent/components/agent-session-panel-model-types";

if (process.env.MOSOO_TEST_PREVIEW_PANEL !== "1") {
  test("Preview panel replaces removed or expired Previews with one coalesced create", async () => {
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
    type: "preview",
  });
  let sessions = [makeSession(OLD)];
  let creates = 0;
  let expiredSessionId: string | null = null;
  let heldSend: Promise<void> = Promise.resolve();
  const sent: { sessionId: string; text: string }[] = [];
  const noOp = async () => {};

  mock.module("@/domains/session/api/agent-session", () => ({
    listAgentSessions: async () => sessions,
    createAgentSession: async () => {
      creates += 1;
      const created = makeSession(createPlatformId<SessionId>());
      sessions = [created];
      return created;
    },
    triggerAgentSessionPrewarm: noOp,
  }));
  mock.module("@/domains/session/api/mutations", () => ({
    deleteAgentSession: noOp,
  }));
  mock.module("@/shared/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
  mock.module("@/domains/runtime/use-session-stream", () => ({
    useSessionStream: () => ({
      hydrated: true,
      lifecycle: "IDLE",
      messages: [],
      reconnecting: false,
      streaming: false,
      run: { id: null },
      sendUserMessage: async (input: { sessionId: string; text: string }) => {
        await heldSend;
        if (input.sessionId === expiredSessionId) {
          throw new Error("This debug Preview expired after 30 days without activity.");
        }
        sent.push(input);
      },
      sendUserInterrupt: noOp,
    }),
  }));

  test("existing, configuration-changed, removed and server-expired Previews", async () => {
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
        configurationChangedAt,
        readiness,
      });
      return <div data-session={currentModel.activeSessionId} />;
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const element = dom.window.document.getElementById("root")!;
    const root = createRoot(element);
    const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 20));
    const render = async () => {
      await act(async () => {
        root.render(
          <QueryClientProvider client={client}>
            <Harness />
          </QueryClientProvider>,
        );
      });
      await act(tick);
    };
    const refetchList = async () => {
      await act(async () => {
        await client.invalidateQueries({ queryKey: ["agent-session-list"] });
        await tick();
      });
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
      // The message shows like a sent one while the send is in flight; the
      // stream never echoes it here, so it is gone once the send settles.
      let release = (): void => {};
      heldSend = new Promise((resolve) => {
        release = resolve;
      });
      let inFlight = Promise.resolve(false);
      await act(async () => {
        inFlight = model().handleSend({ text: "Continue the original configuration" });
        await tick();
      });
      expect(model().messages).toEqual([
        expect.objectContaining({ content: "Continue the original configuration", role: "user" }),
      ]);
      expect(model().streaming).toBe(true);
      await act(async () => {
        release();
        expect(await inFlight).toBe(true);
      });
      expect(model().messages).toEqual([]);
      expect(model().streaming).toBe(false);
      expect(sent).toEqual([
        expect.objectContaining({ sessionId: OLD, text: "Continue the original configuration" }),
      ]);
      expect(creates).toBe(0);

      configurationChangedAt = null;
      readiness = null;
      await render();
      sessions = [];
      await refetchList();
      expect(model().activeSessionId).toBeNull();
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
      expect(model().activeSessionId).toBe(replaced[0]);

      // The server rejects the expired Preview and no longer lists it; the
      // failed send refreshes the list, so Retry lands in a new Preview.
      expiredSessionId = replaced[0]!;
      sessions = [];
      await act(async () => {
        expect(await model().handleSend({ text: "Lost to expiry" })).toBe(false);
      });
      await act(tick);
      expect(model().messages).toEqual([]);
      expect(model().composerError?.retryable).toBe(true);
      expect(model().activeSessionId).toBeNull();
      await act(async () => {
        expect(await model().handleSend({ text: "Retry in a new Preview" })).toBe(true);
      });
      await act(tick);
      expect(creates).toBe(2);
      expect(sent.at(-1)?.sessionId).not.toBe(replaced[0]);
      expect(sent.at(-1)).toMatchObject({ text: "Retry in a new Preview" });
    } finally {
      await act(async () => {
        root.unmount();
      });
      client.clear();
      dom.window.close();
    }
  });
}
