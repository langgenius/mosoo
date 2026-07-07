import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { JSDOM } from "jsdom";
import { act } from "react";
import type { Root } from "react-dom/client";

import { AGENT_INSTANCE_AGENTS } from "../src/routes/app-overview/deploy/agent-instance-data";

let dom: JSDOM | null = null;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function installDom(): void {
  dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/v0-deploy-preview",
    pretendToBeVisual: true,
  });
  const { window } = dom;

  globalThis.window = window as unknown as Window & typeof globalThis;
  globalThis.document = window.document;
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: window.location,
  });
  globalThis.Element = window.Element;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.HTMLButtonElement = window.HTMLButtonElement;
  globalThis.Node = window.Node;
  globalThis.Event = window.Event;
  globalThis.MouseEvent = window.MouseEvent;
  globalThis.MutationObserver = window.MutationObserver;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: window.navigator,
  });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });
}

function uninstallDom(): void {
  root = null;
  container = null;
  dom?.window.close();
  dom = null;
  delete globalThis.window;
  delete globalThis.document;
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: undefined,
  });
  delete globalThis.Element;
  delete globalThis.HTMLElement;
  delete globalThis.HTMLButtonElement;
  delete globalThis.Node;
  delete globalThis.Event;
  delete globalThis.MouseEvent;
  delete globalThis.MutationObserver;
  delete globalThis.getComputedStyle;
  delete globalThis.requestAnimationFrame;
  delete globalThis.cancelAnimationFrame;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: undefined,
  });
}

async function renderDashboard(): Promise<void> {
  const [{ createRoot }, { MemoryRouter }, { AgentDashboard }] = await Promise.all([
    import("react-dom/client"),
    import("react-router-dom"),
    import("../src/routes/app-overview/deploy/components/agent-dashboard"),
  ]);

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <MemoryRouter>
        <AgentDashboard agents={AGENT_INSTANCE_AGENTS} onSelect={() => undefined} />
      </MemoryRouter>,
    );
  });
}

async function renderDetail(): Promise<void> {
  const [{ createRoot }, { MemoryRouter }, { AgentInstancePanel }] = await Promise.all([
    import("react-dom/client"),
    import("react-router-dom"),
    import("../src/routes/app-overview/deploy/components/agent-instance-panel"),
  ]);

  const [primary] = AGENT_INSTANCE_AGENTS;
  if (primary === undefined) {
    throw new Error("expected at least one agent fixture");
  }

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <MemoryRouter>
        <AgentInstancePanel fixture={primary} onBack={() => undefined} />
      </MemoryRouter>,
    );
  });
}

beforeEach(() => {
  installDom();
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => {
      root?.unmount();
    });
  }

  uninstallDom();
});

describe("Agent dashboard", () => {
  test("renders the stat tiles and a clickable agent row", async () => {
    await renderDashboard();

    const dashboard = document.querySelector('[data-testid="agent-dashboard"]');
    expect(dashboard).not.toBeNull();

    const text = dashboard?.textContent ?? "";

    // The four stat tiles that head the agent list.
    expect(text).toContain("Live agents");
    expect(text).toContain("Sessions today");
    expect(text).toContain("Spend today");
    expect(text).toContain("Deployed agents");

    // The list renders one row per deployed agent, each a way into its detail.
    const rows = document.querySelectorAll('[data-testid="agent-dashboard-row"]');
    expect(rows.length).toBe(AGENT_INSTANCE_AGENTS.length);
    expect(text).toContain("quiz-master");
  });
});

describe("Agent instance detail", () => {
  test("anchors on the Address spine and reuses the web Activity, with no chat console", async () => {
    await renderDetail();

    const panel = document.querySelector('[data-testid="agent-instance-panel"]');
    expect(panel).not.toBeNull();

    const text = panel?.textContent ?? "";

    // The Address spine surfaces the name-addressed create-thread endpoint and
    // the App OpenAPI URL.
    expect(text).toContain("/api/v1/apps/roadmap-agents/agents/quiz-master/threads");
    expect(text).toContain("/api/v1/apps/roadmap-agents/openapi.json");

    // Activity is literally the web console's section, fed this agent's runs.
    expect(text).toContain("Production Activity");
    expect(document.querySelector('[data-testid="deploy-run-row"]')).not.toBeNull();

    // The secondary blocks the detail keeps around the spine.
    expect(text).toContain("Exposed surfaces");
    expect(text).toContain("Checkpoints");

    // The borrowed chat console is gone: no "A way in", no delegation composer.
    expect(text).not.toContain("A way in");
    expect(document.querySelector('input[aria-label="Send a delegation"]')).toBeNull();
  });
});
