import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import type { AgentDeploymentVersion } from "@mosoo/contracts/agent";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { act } from "react";
import type { Root } from "react-dom/client";

import type { Agent } from "../src/routes/agent/agent.types";
import { toAccountId, toAgentDeploymentVersionId, toAgentId } from "../src/routes/typed-id";

// The runtime badge pulls brand SVGs at module load; a sibling test's global
// brand-icons mock poisons bun's SVG loader across files, so stub the icon.
mock.module("@/shared/ui/brand-icons/runtime-icon", () => ({
  RuntimeIcon: () => null,
  hasRuntimeIcon: () => false,
}));

const AGENT_ID = "01J00000000000000000000001";
const APP_ID = "01J00000000000000000000009";
const VERSION_WITH_SHA_ID = "01J00000000000000000000002";
const VERSION_WITHOUT_SHA_ID = "01J00000000000000000000003";
const ACCOUNT_ID = "01J00000000000000000000004";

let dom: JSDOM | null = null;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function installDom(): void {
  dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/agent",
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
  globalThis.ShadowRoot = window.ShadowRoot;
  globalThis.NodeFilter = window.NodeFilter;
  globalThis.Event = window.Event;
  globalThis.MouseEvent = window.MouseEvent;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.KeyboardEvent = window.KeyboardEvent;
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
  Object.defineProperty(window.HTMLElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => false,
  });
  Object.defineProperty(window.HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(window.HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: () => undefined,
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
  delete globalThis.ShadowRoot;
  delete globalThis.NodeFilter;
  delete globalThis.Event;
  delete globalThis.MouseEvent;
  delete globalThis.CustomEvent;
  delete globalThis.KeyboardEvent;
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

function createVersion(
  id: string,
  versionNumber: number,
  overrides: Partial<AgentDeploymentVersion> = {},
): AgentDeploymentVersion {
  return {
    agentId: toAgentId(AGENT_ID),
    createdAt: "2026-07-01T00:00:00.000Z",
    createdByAccountId: toAccountId(ACCOUNT_ID),
    environmentId: null,
    id: toAgentDeploymentVersionId(id),
    isLive: false,
    kind: "cattle",
    model: "gpt-5.4-mini",
    provider: "openai",
    runtimeId: "opencode",
    summary: `Version ${versionNumber}`,
    versionNumber,
    ...overrides,
  };
}

function createAgent(versions: AgentDeploymentVersion[]): Agent {
  return {
    appId: APP_ID,
    config: {
      builtInTools: [],
      environmentId: null,
      mcpServers: [],
      model: "gpt-5.4-mini",
      prompt: "You are helpful.",
      providerOptions: {},
      skills: [],
    },
    createdAt: "2026-07-01T00:00:00.000Z",
    description: "A native deployable agent.",
    id: AGENT_ID,
    kind: "cattle",
    liveVersion: null,
    name: "Quiz Master",
    owner: { email: "owner@example.com", id: ACCOUNT_ID, name: "Owner" },
    packageResolution: null,
    provider: "openai",
    readiness: null,
    role: "owner",
    runtime: "opencode",
    status: "published",
    tools: [],
    updatedAt: "2026-07-01T00:00:00.000Z",
    versions,
    visibility: "private",
  };
}

async function renderPublishSuccessModal(agent: Agent): Promise<void> {
  const [{ createRoot }, { MemoryRouter }, { PublishSuccessModal }] = await Promise.all([
    import("react-dom/client"),
    import("react-router-dom"),
    import("../src/routes/agent/lifecycle/publish-success-modal"),
  ]);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PublishSuccessModal agent={agent} onOpenChange={() => undefined} open />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
}

async function renderVersionsTab(agent: Agent): Promise<void> {
  const [{ createRoot }, { VersionsTab }] = await Promise.all([
    import("react-dom/client"),
    import("../src/routes/agent/components/versions-tab"),
  ]);

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(<VersionsTab agent={agent} />);
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

describe("Native deliverable surfaces", () => {
  test("publish success modal shows the export CTA and conformance line", async () => {
    await renderPublishSuccessModal(createAgent([]));

    const cta = document.querySelector('[data-testid="publish-export-native-repo"]');
    expect(cta).not.toBeNull();
    expect(cta?.textContent ?? "").toContain("Export deployable repo (.zip)");

    const block = document.querySelector('[data-testid="publish-native-deliverable"]');
    expect(block).not.toBeNull();
    expect(block?.textContent ?? "").toContain(
      "Same artifact mosoo deploy consumes · validates green",
    );
  });

  test("versions tab renders the commit sha only for repo-backed versions", async () => {
    await renderVersionsTab(
      createAgent([
        createVersion(VERSION_WITH_SHA_ID, 2, { sourceCommitSha: "abc1234def567" }),
        createVersion(VERSION_WITHOUT_SHA_ID, 1),
      ]),
    );

    const shaCells = Array.from(document.querySelectorAll('[data-testid="version-commit-sha"]'));
    // Only the version carrying a sourceCommitSha renders the commit metadatum.
    expect(shaCells.length).toBe(1);
    expect(shaCells[0]?.textContent ?? "").toContain("commit abc1234");
    // The first seven characters only — the full sha never leaks into the row.
    expect(shaCells[0]?.textContent ?? "").not.toContain("abc1234def567");
  });
});
