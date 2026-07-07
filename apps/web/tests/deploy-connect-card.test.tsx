import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { JSDOM } from "jsdom";
import { act } from "react";
import type { Root } from "react-dom/client";

import { createDeployConsoleFixture } from "../src/routes/app-overview/deploy/deploy-console-data";
import type { DeployConsoleScenario } from "../src/routes/app-overview/deploy/deploy-console-data";

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

async function renderDeployOverview(scenario: DeployConsoleScenario): Promise<void> {
  const [{ createRoot }, { MemoryRouter }, { DeployOverview }] = await Promise.all([
    import("react-dom/client"),
    import("react-router-dom"),
    import("../src/routes/app-overview/deploy/components/deploy-overview"),
  ]);
  const { agents, deployment, runs } = createDeployConsoleFixture(scenario);
  if (deployment === null) {
    throw new Error("Expected the fixture to carry a deployment.");
  }

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <MemoryRouter>
        <DeployOverview
          agents={agents}
          deployment={deployment}
          latestRun={runs[0]}
          localPreview={{ refresh: () => undefined, status: "offline", url: null }}
          deploying={false}
          deployError={null}
          onDeployRepo={() => undefined}
        />
      </MemoryRouter>,
    );
  });
}

/** A 26-char Crockford base32 ULID (upper-case, excludes I/L/O/U). */
const ULID_PATTERN = /[0-9A-HJKMNP-TV-Z]{26}/;

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

describe("Deploy Connect card", () => {
  test("renders a name-addressed surface table for a multi-agent protocol deploy", async () => {
    await renderDeployOverview("web-and-agents");

    const card = document.querySelector('[data-testid="deploy-connect-card"]');
    expect(card).not.toBeNull();

    // Both exposed agents of the latest run become surface-table rows.
    const rows = Array.from(document.querySelectorAll('[data-testid="deploy-agent-surface-row"]'));
    expect(rows.length).toBe(2);

    const rowText = rows.map((row) => row.textContent ?? "").join("\n");
    expect(rowText).toContain("POST /api/v1/apps/roadmap-board/agents/roadmap/threads");
    expect(rowText).toContain("POST /api/v1/apps/roadmap-board/agents/triage/threads");

    // The worked curl anchors the card and is name-addressed for the first agent.
    const cardText = card?.textContent ?? "";
    expect(cardText).toContain("curl -X POST");
    expect(cardText).toContain("/api/v1/apps/roadmap-board/agents/roadmap/threads");

    // The namespace base and the both-mode badge are present.
    expect(cardText).toContain("/api/v1/apps/roadmap-board");
    expect(cardText).toContain("web + agent api");

    // Name-addressed means the card's visible text carries no agent ULID.
    expect(cardText).not.toMatch(ULID_PATTERN);
  });

  test("shows the Connect card without a table for an agent-only deploy", async () => {
    await renderDeployOverview("agent-only");

    const card = document.querySelector('[data-testid="deploy-connect-card"]');
    expect(card).not.toBeNull();

    const cardText = card?.textContent ?? "";
    // The agent-only latest run exposes quiz-master and triage-helper.
    expect(cardText).toContain("/api/v1/apps/quiz-agents/agents/quiz-master/threads");
    // A single-species agent api reads "agent api", never "web + agent api".
    expect(cardText).toContain("agent api");
    expect(cardText).not.toContain("web + agent api");
    expect(cardText).not.toMatch(ULID_PATTERN);
  });

  test("omits the Connect card when the latest run exposes no agents", async () => {
    // The native-red latest run failed with no provisioned agents; the web
    // scenario is a legacy deploy with no slug and no native facts.
    await renderDeployOverview("native-red");
    expect(document.querySelector('[data-testid="deploy-connect-card"]')).toBeNull();

    await act(async () => {
      root?.unmount();
    });
    root = null;
    if (container !== null) {
      container.remove();
      container = null;
    }

    await renderDeployOverview("web");
    expect(document.querySelector('[data-testid="deploy-connect-card"]')).toBeNull();
  });
});
