import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { JSDOM } from "jsdom";
import { act } from "react";
import type { Root } from "react-dom/client";

import { createDeployConsoleFixture } from "../src/routes/app-overview/deploy/deploy-console-data";

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

async function renderNativeRedHistory(): Promise<void> {
  const [{ createRoot }, { DeploymentsHistory }] = await Promise.all([
    import("react-dom/client"),
    import("../src/routes/app-overview/deploy/components/deployments-history"),
  ]);
  const { runs } = createDeployConsoleFixture("native-red");

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(<DeploymentsHistory runs={runs} />);
  });
}

function getDetailsButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll("button")).filter(
    (element) => element.textContent?.trim() === "Details",
  );
}

async function click(element: HTMLElement | undefined): Promise<void> {
  if (element === undefined) {
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

describe("DeploymentsHistory native failure expansion", () => {
  test("expands a native-red run into repo-term failure rows with fix actions", async () => {
    await renderNativeRedHistory();

    // Both runs of the native-red fixture carry native details.
    const detailsButtons = getDetailsButtons();
    expect(detailsButtons.length).toBe(2);

    // No placeholder target line anywhere: the failed run names the spec and
    // agent count, the previous green run names spec · target · agents.
    const detections = Array.from(
      document.querySelectorAll('[data-testid="deploy-run-detection"]'),
    );
    expect(detections.map((node) => node.textContent?.trim())).toEqual([
      "mosoo-native v1 · 2 agents",
      "mosoo-native v1 · worker · 2 agents",
    ]);
    expect(document.body.textContent).not.toContain("detecting target");

    await click(detailsButtons[0]);

    const details = document.querySelector('[data-testid="deploy-run-details"]');
    expect(details).not.toBeNull();
    // The run-level native error code and message render alongside the rows.
    expect(details?.textContent).toContain("native_validation_failed");
    expect(details?.textContent).toContain("nothing was deployed");

    const failureRows = Array.from(document.querySelectorAll('[data-testid="deploy-failure-row"]'));
    expect(failureRows.length).toBe(3);

    const manifestRow = failureRows[0];
    expect(manifestRow?.textContent).toContain("[error]");
    expect(manifestRow?.textContent).toContain(".agent/agents/quiz-master/manifest.json");
    expect(manifestRow?.textContent).toContain("manifest file is missing");
    // The fix-action line carries the repo-term instruction verbatim.
    expect(manifestRow?.textContent).toContain(
      "add .agent/agents/quiz-master/manifest.json with name, runtime and model",
    );
    expect(manifestRow?.querySelector(".text-destructive")).not.toBeNull();

    const exposeRow = failureRows[1];
    expect(exposeRow?.textContent).toContain(".mosoo.toml:expose.agents");

    const setupRow = failureRows[2];
    expect(setupRow?.textContent).toContain("[setup_required]");
    expect(setupRow?.textContent).toContain(".agent/environment/definition.json:OPENAI_API_KEY");
    // A setup note is neutral, never styled as an error.
    expect(setupRow?.querySelector(".text-destructive")).toBeNull();
  });

  test("expands a green native run into per-agent provision rows", async () => {
    await renderNativeRedHistory();

    await click(getDetailsButtons()[1]);

    const provisionRows = Array.from(
      document.querySelectorAll('[data-testid="deploy-provision-row"]'),
    );
    expect(provisionRows.length).toBe(2);
    expect(provisionRows[0]?.textContent).toContain("roadmap");
    expect(provisionRows[0]?.textContent).toContain("updated");
    expect(provisionRows[0]?.textContent).toContain("v3");
    expect(provisionRows[1]?.textContent).toContain("triage");
    expect(provisionRows[1]?.textContent).toContain("unchanged");
    // No version was minted for the unchanged agent, so no version renders.
    expect(provisionRows[1]?.textContent).not.toContain("v3");

    // A green run has no failure rows and no run-level error block.
    expect(document.querySelectorAll('[data-testid="deploy-failure-row"]').length).toBe(0);
    const details = document.querySelector('[data-testid="deploy-run-details"]');
    expect(details?.textContent).not.toContain("Failure details");
  });
});
