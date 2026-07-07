import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { JSDOM } from "jsdom";
import { act } from "react";
import type { Root } from "react-dom/client";

import { AGENT_INSTANCE_FIXTURE } from "../src/routes/app-overview/deploy/agent-instance-data";

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

async function renderPanel(): Promise<void> {
  const [{ createRoot }, { MemoryRouter }, { AgentInstancePanel }] = await Promise.all([
    import("react-dom/client"),
    import("react-router-dom"),
    import("../src/routes/app-overview/deploy/components/agent-instance-panel"),
  ]);

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <MemoryRouter>
        <AgentInstancePanel fixture={AGENT_INSTANCE_FIXTURE} />
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

describe("Agent instance panel", () => {
  test("renders the instance blocks, the endpoint, and the human-in-the-loop control", async () => {
    await renderPanel();

    const panel = document.querySelector('[data-testid="agent-instance-panel"]');
    expect(panel).not.toBeNull();

    const text = panel?.textContent ?? "";

    // The console centerpiece plus the right-rail blocks that frame the agent as
    // a compute instance: its Address, Exposed surfaces, Checkpoints, and Recent.
    expect(text).toContain("A way in");
    expect(text).toContain("Address");
    expect(text).toContain("Exposed surfaces");
    expect(text).toContain("Checkpoints");
    expect(text).toContain("Recent");

    // Block 1 surfaces the name-addressed create-thread endpoint and OpenAPI URL.
    expect(text).toContain("/api/v1/apps/roadmap-agents/agents/quiz-master/threads");
    expect(text).toContain("/api/v1/apps/roadmap-agents/openapi.json");

    // Block 2 conveys "intervene": a pending tool call exposes an Approve control.
    const approve = Array.from(document.querySelectorAll("button")).find((button) =>
      (button.textContent ?? "").includes("Approve"),
    );
    expect(approve).toBeDefined();

    // The composer conveys "talk": a delegation input is present.
    expect(document.querySelector('input[aria-label="Send a delegation"]')).not.toBeNull();
  });
});
