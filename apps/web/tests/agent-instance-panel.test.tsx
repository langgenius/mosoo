import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { JSDOM } from "jsdom";
import { act } from "react";
import type { Root } from "react-dom/client";

import {
  AGENT_INSTANCE_AGENTS,
  INSTANCE_RUNS,
} from "../src/routes/app-overview/deploy/agent-instance-data";

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

async function renderInstance(): Promise<void> {
  const [{ createRoot }, { MemoryRouter }, { AgentDashboard }, { ActivitySection }] =
    await Promise.all([
      import("react-dom/client"),
      import("react-router-dom"),
      import("../src/routes/app-overview/deploy/components/agent-dashboard"),
      import("../src/routes/app-overview/deploy/components/deployments-history"),
    ]);

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <MemoryRouter>
        <AgentDashboard
          agents={AGENT_INSTANCE_AGENTS}
          activity={<ActivitySection runs={INSTANCE_RUNS} />}
        />
      </MemoryRouter>,
    );
  });
}

async function click(element: Element | null | undefined): Promise<void> {
  if (!(element instanceof HTMLElement)) {
    throw new Error("Expected a clickable element.");
  }

  await act(async () => {
    element.click();
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

describe("Agent instance list", () => {
  test("renders a modest Agents section (no big h1), both plane tags, and activity below", async () => {
    await renderInstance();

    const dashboard = document.querySelector('[data-testid="agent-dashboard"]');
    expect(dashboard).not.toBeNull();

    // This content lives inside the Overview: there is NO big page title, only a
    // modest section heading matching the "Production Activity" weight (an h2).
    expect(document.querySelector("h1")).toBeNull();
    const agentsHeading = [...document.querySelectorAll("h2")].find(
      (heading) => heading.textContent === "Agents",
    );
    expect(agentsHeading).toBeDefined();

    // One row per deployed agent; each is a way to expand its address in place.
    const rows = document.querySelectorAll('[data-testid="agent-dashboard-row"]');
    expect(rows.length).toBe(AGENT_INSTANCE_AGENTS.length);

    const text = dashboard?.textContent ?? "";
    expect(text).toContain("quiz-master");
    // The two consumption planes, tagged by plane not thing-type.
    expect(text).toContain("API");
    expect(text).toContain("Web");

    // Production Activity is repo-level: rendered ONCE below the list.
    const activity = document.querySelector('[data-testid="instance-activity"]');
    expect(activity).not.toBeNull();
    expect(activity?.textContent ?? "").toContain("Production Activity");
    expect(
      activity?.querySelectorAll('[data-testid="deploy-run-row"]').length ?? 0,
    ).toBeGreaterThan(0);
  });

  test("expands rows independently — two can be open at once", async () => {
    await renderInstance();

    // quiz-master and triage-helper are both api-plane rows, in order.
    const rows = document.querySelectorAll('[data-testid="agent-dashboard-row"]');
    await click(rows[0]);
    await click(rows[1]);

    // Opening the second row did NOT collapse the first: both cards are present.
    const cards = document.querySelectorAll('[data-testid="agent-address-card"]');
    expect(cards.length).toBe(2);

    const text = document.querySelector('[data-testid="agent-dashboard"]')?.textContent ?? "";
    expect(text).toContain("/api/v1/apps/roadmap-agents/agents/quiz-master/threads");
    expect(text).toContain("/api/v1/apps/roadmap-agents/agents/triage-helper/threads");
  });

  test("expands an API row to Endpoint + Example request, exactly two Copy buttons", async () => {
    await renderInstance();

    // quiz-master is the first row and an `api`-plane instance.
    const rows = document.querySelectorAll('[data-testid="agent-dashboard-row"]');
    await click(rows[0]);

    const card = document.querySelector('[data-testid="agent-address-card"]');
    expect(card).not.toBeNull();

    const text = card?.textContent ?? "";
    // The two distinct, relabelled blocks: the URL endpoint and the runnable curl.
    expect(text).toContain("Endpoint");
    expect(text).toContain("Example request");
    expect(text).toContain("POST https://try.mosoo.ai");
    expect(text).toContain("/api/v1/apps/roadmap-agents/agents/quiz-master/threads");
    expect(text).toContain("curl -X POST");

    // Exactly ONE curl block, and no removed redundant affordances.
    expect(card?.querySelectorAll("pre").length).toBe(1);
    expect(text).not.toContain("Shell into it");
    expect(text).not.toContain("OpenAPI");

    // Copy is capped at two affordances: the endpoint and the example request.
    // The token hint is a link, not a copy button.
    expect(card?.querySelectorAll('button[aria-label^="Copy"]').length).toBe(2);
    expect(text).toContain("personal access token");
  });

  test("expands a Web row to a URL and Open link, not a curl", async () => {
    await renderInstance();

    const webIndex = AGENT_INSTANCE_AGENTS.findIndex((agent) => agent.plane === "web");
    expect(webIndex).toBeGreaterThanOrEqual(0);

    const rows = document.querySelectorAll('[data-testid="agent-dashboard-row"]');
    await click(rows[webIndex]);

    const card = document.querySelector('[data-testid="agent-address-card"]');
    expect(card).not.toBeNull();

    const text = card?.textContent ?? "";
    // A live web URL and an Open link — never a curl for a web surface.
    expect(text).toContain("digest.apps.mosoo.ai");
    expect(text).toContain("Open");
    expect(card?.querySelector("pre")).toBeNull();
  });
});
