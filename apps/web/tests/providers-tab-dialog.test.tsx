import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { act } from "react";
import type { Root } from "react-dom/client";

const PROJECT_ID = "01J00000000000000000000009";
const CUSTOM_CREDENTIAL_ID = "01J000000000000000000000AA";
const MINIMAX_CREDENTIAL_ID = "01J000000000000000000000MM";
const originalFetch = globalThis.fetch;
let dom: JSDOM | null = null;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

mock.module("@/shared/ui/brand-icons", () => ({
  RuntimeIcon: () => null,
  VendorIcon: () => null,
  hasRuntimeIcon: () => false,
  hasVendorIcon: () => false,
}));

interface CapturedGraphQLBody {
  query: string;
  variables?: unknown;
}

function installDom(): void {
  dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/providers",
    pretendToBeVisual: true,
  });
  const { window } = dom;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: window,
    writable: true,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: window.document,
    writable: true,
  });
  globalThis.Element = window.Element;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.HTMLButtonElement = window.HTMLButtonElement;
  globalThis.HTMLInputElement = window.HTMLInputElement;
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
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => undefined,
    },
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
  delete globalThis.HTMLInputElement;
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

function parseGraphQLBody(init: RequestInit | undefined): CapturedGraphQLBody {
  if (typeof init?.body !== "string") {
    throw new Error("Expected GraphQL request body to be serialized JSON.");
  }

  const body = JSON.parse(init.body);

  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    typeof body.query !== "string"
  ) {
    throw new Error("Expected GraphQL request body to include a query string.");
  }

  return body as CapturedGraphQLBody;
}

function listResponse(credentials: unknown[] = []): Response {
  return Response.json({
    data: {
      vendorCredentialList: credentials,
    },
  });
}

function createdCustomCredentialResponse(): Response {
  return Response.json({
    data: {
      createVendorCredential: {
        apiBase: "https://custom.example.com/v1",
        id: CUSTOM_CREDENTIAL_ID,
        isDefault: true,
        maskedApiKey: "sk-***",
        models: ["custom-large", "custom-small"],
        modelProtocol: "openai-chat-completions",
        name: "Custom gateway",
        projectId: PROJECT_ID,
        vendorId: "openai-compatible",
      },
    },
  });
}

function updatedMinimaxCredentialResponse(): Response {
  return Response.json({
    data: {
      updateVendorCredential: {
        apiBase: "https://api.minimax.io/anthropic/v1",
        id: MINIMAX_CREDENTIAL_ID,
        isDefault: true,
        maskedApiKey: "eyJh••••OSmA",
        modelProtocol: null,
        models: null,
        name: "mm",
        projectId: PROJECT_ID,
        vendorId: "minimax",
      },
    },
  });
}

function setupFetch(credentials: unknown[] = []): CapturedGraphQLBody[] {
  const capturedBodies: CapturedGraphQLBody[] = [];

  globalThis.fetch = async (_input, init) => {
    const body = parseGraphQLBody(init);
    capturedBodies.push(body);

    if (body.query.includes("createVendorCredential")) {
      return createdCustomCredentialResponse();
    }

    if (body.query.includes("updateVendorCredential")) {
      return updatedMinimaxCredentialResponse();
    }

    if (body.query.includes("testVendorCredential")) {
      return Response.json({
        data: { testVendorCredential: { errorCode: null, latencyMs: 1, ok: true } },
      });
    }

    return listResponse(credentials);
  };

  return capturedBodies;
}

async function renderProviders(): Promise<QueryClient> {
  const [{ createRoot }, { ProvidersTab }, { I18nProvider }] = await Promise.all([
    import("react-dom/client"),
    import("../src/routes/providers/providers-tab"),
    import("../src/shared/i18n/provider"),
  ]);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <ProvidersTab projectId={PROJECT_ID} />
        </I18nProvider>
      </QueryClientProvider>,
    );
  });

  await waitFor(() => {
    expect(document.body.textContent).not.toContain("Loading providers");
  });
  return queryClient;
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    if (!(element instanceof HTMLElement)) {
      throw new Error("Expected a clickable HTMLElement.");
    }

    element.click();
  });
}

async function fillLabeledInput(labelText: string, value: string): Promise<void> {
  const input = getInputByLabel(labelText);
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

  if (valueSetter === undefined) {
    throw new Error("Expected HTMLInputElement value setter.");
  }

  await act(async () => {
    valueSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
  });
}

async function openCustomModelDialog(): Promise<void> {
  await click(getButton("Add custom provider"));
  await waitFor(() => {
    expect(queryDialog()).not.toBeNull();
  });
}

function protocolSelect(): HTMLElement {
  const label = Array.from(document.querySelectorAll("label")).find(
    (element) => element.textContent === "Model protocol",
  );
  const trigger = label?.htmlFor ? document.getElementById(label.htmlFor) : null;
  if (!(trigger instanceof HTMLElement)) {
    throw new Error("Model protocol selector not found.");
  }
  return trigger;
}

async function selectProtocol(label: string): Promise<void> {
  await click(protocolSelect());
  let option: Element | undefined;
  await waitFor(() => {
    option = Array.from(document.querySelectorAll('[role="option"]')).find(
      (element) => element.textContent === label,
    );
    expect(option).toBeDefined();
  });
  if (option === undefined) {
    throw new Error(`Missing model protocol: ${label}`);
  }
  await click(option);
}

function getButton(name: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find(
    (element) => element.textContent?.trim() === name,
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Unable to find button: ${name}`);
  }

  return button;
}

function getButtonByLabel(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find(
    (element) => element.getAttribute("aria-label") === label,
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Unable to find button with aria-label: ${label}`);
  }

  return button;
}

function getInputByLabel(labelText: string): HTMLInputElement {
  const label = Array.from(document.querySelectorAll("label")).find((element) =>
    element.textContent?.includes(labelText),
  );
  const input = label?.htmlFor ? document.getElementById(label.htmlFor) : null;

  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Unable to find input for label: ${labelText}`);
  }

  return input;
}

function queryDialog(): Element | null {
  return document.querySelector('[role="dialog"], [data-slot="dialog-content"]');
}

async function waitFor(assertion: () => void): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    try {
      assertion();
      return;
    } catch (caughtError) {
      lastError = caughtError;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  throw lastError;
}

beforeEach(() => {
  installDom();
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => {
      root?.unmount();
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  globalThis.fetch = originalFetch;
  uninstallDom();
});

describe("ProvidersTab custom model dialog", () => {
  test("opens custom model form in a dialog instead of an inline custom card", async () => {
    setupFetch();
    await renderProviders();

    expect(document.querySelector("main")?.textContent).not.toContain("Custom provider");

    await openCustomModelDialog();

    const dialog = queryDialog();
    expect(dialog?.textContent).toContain("Add Custom provider key");
    expect(dialog?.textContent).toContain("Base URL");
    expect(dialog?.textContent).toContain("Models");
    expect(protocolSelect().textContent).toContain("OpenAI Chat Completions");
    expect(document.querySelector("main")?.textContent).not.toContain("Add Custom provider key");
  });

  test("cancel closes the custom model dialog and clears draft state", async () => {
    setupFetch();
    await renderProviders();

    await openCustomModelDialog();
    await fillLabeledInput("Name", "Draft gateway");
    await click(getButton("Cancel"));

    await waitFor(() => {
      expect(queryDialog()).toBeNull();
    });

    await openCustomModelDialog();

    expect(getInputByLabel("Name").value).toBe("");
  });

  test("save creates a custom credential and closes the dialog", async () => {
    const capturedBodies = setupFetch();
    const queryClient = await renderProviders();
    const modelsQueryKey = ["available-agent-models", PROJECT_ID, "openai-runtime", null, null];
    queryClient.setQueryData(modelsQueryKey, []);

    await openCustomModelDialog();
    await fillLabeledInput("Name", "Custom gateway");
    await fillLabeledInput("Base URL", "https://custom.example.com/v1");
    await fillLabeledInput("API key", "sk-test");
    await fillLabeledInput("Models", "custom-large, custom-small");
    await click(getButton("Save"));

    await waitFor(() => {
      expect(queryDialog()).toBeNull();
    });

    const createBody = capturedBodies.find((body) => body.query.includes("createVendorCredential"));

    expect(createBody?.variables).toEqual({
      input: {
        apiBase: "https://custom.example.com/v1",
        apiKey: "sk-test",
        models: ["custom-large", "custom-small"],
        modelProtocol: "openai-chat-completions",
        name: "Custom gateway",
        projectId: PROJECT_ID,
        vendorId: "openai-compatible",
      },
    });
    expect(queryClient.getQueryState(modelsQueryKey)?.isInvalidated).toBe(true);
  });

  test("edit mode shows the masked key without resubmitting it when unchanged", async () => {
    const capturedBodies = setupFetch([
      {
        apiBase: "https://api.minimax.io/anthropic/v1",
        id: MINIMAX_CREDENTIAL_ID,
        isDefault: true,
        maskedApiKey: "eyJh••••OSmA",
        modelProtocol: null,
        models: null,
        name: "mm",
        projectId: PROJECT_ID,
        vendorId: "minimax",
      },
    ]);
    await renderProviders();

    await click(getButtonByLabel("Edit mm key"));

    await waitFor(() => {
      expect(queryDialog()?.textContent).toContain("Edit MiniMax key");
    });

    const apiKeyInput = getInputByLabel("API key");
    expect(apiKeyInput.value).toBe("");
    expect(apiKeyInput.placeholder).toBe("Current key: eyJh••••OSmA");
    expect(apiKeyInput.autocomplete).toBe("new-password");
    expect(apiKeyInput.name).toContain("provider-secret");

    await click(getButton("Save"));

    await waitFor(() => {
      expect(queryDialog()).toBeNull();
    });

    const updateBody = capturedBodies.find((body) => body.query.includes("updateVendorCredential"));

    expect(updateBody?.variables).toEqual({
      input: {
        apiBase: "https://api.minimax.io/anthropic/v1",
        id: MINIMAX_CREDENTIAL_ID,
        name: "mm",
        projectId: PROJECT_ID,
      },
    });
  });

  test.each([
    ["OpenAI Chat Completions", "openai-chat-completions"],
    ["OpenAI Responses", "openai-responses"],
    ["Anthropic Messages", "anthropic-messages"],
    ["Google Gemini", "google-gemini"],
  ])("test and save use the selected %s protocol", async (label, modelProtocol) => {
    const capturedBodies = setupFetch();
    await renderProviders();
    await openCustomModelDialog();
    await fillLabeledInput("Name", "Protocol gateway");
    await fillLabeledInput("Base URL", "https://custom.example.com/v1");
    await fillLabeledInput("API key", "sk-test");
    await fillLabeledInput("Models", "custom-model");
    await selectProtocol(label);
    await click(getButton("Test"));
    await waitFor(() => expect(queryDialog()?.textContent).toContain("Connection ok"));
    expect(
      capturedBodies.find((body) => body.query.includes("testVendorCredential"))?.variables,
    ).toEqual({
      input: {
        apiBase: "https://custom.example.com/v1",
        apiKey: "sk-test",
        modelId: "custom-model",
        modelProtocol,
        projectId: PROJECT_ID,
        vendorId: "openai-compatible",
      },
    });
    await click(getButton("Save"));
    await waitFor(() => expect(queryDialog()).toBeNull());
    expect(
      capturedBodies.find((body) => body.query.includes("createVendorCredential"))?.variables,
    ).toMatchObject({
      input: { modelProtocol },
    });
  });

  test("keeps an undeclared legacy protocol when editing other fields", async () => {
    const capturedBodies = setupFetch([
      {
        apiBase: "https://custom.example.com/v1",
        id: CUSTOM_CREDENTIAL_ID,
        isDefault: true,
        maskedApiKey: "sk-***",
        modelProtocol: null,
        models: ["legacy-model"],
        name: "Legacy gateway",
        projectId: PROJECT_ID,
        vendorId: "openai-compatible",
      },
    ]);
    await renderProviders();
    await click(getButtonByLabel("Edit Legacy gateway key"));
    expect(protocolSelect().textContent).toContain("Unspecified (legacy configuration)");
    expect(getButton("Test").disabled).toBe(true);
    await fillLabeledInput("Name", "Renamed gateway");
    await click(getButton("Save"));
    await waitFor(() => expect(queryDialog()).toBeNull());
    expect(
      capturedBodies.find((body) => body.query.includes("updateVendorCredential"))?.variables,
    ).toMatchObject({
      input: { modelProtocol: null, name: "Renamed gateway" },
    });
  });

  test("an explicit protocol cannot be reset to unspecified", async () => {
    setupFetch([
      {
        apiBase: "https://custom.example.com/v1",
        id: CUSTOM_CREDENTIAL_ID,
        isDefault: true,
        maskedApiKey: "sk-***",
        modelProtocol: "openai-responses",
        models: ["custom-model"],
        name: "Responses gateway",
        projectId: PROJECT_ID,
        vendorId: "openai-compatible",
      },
    ]);
    await renderProviders();
    await click(getButtonByLabel("Edit Responses gateway key"));
    expect(protocolSelect().textContent).toContain("OpenAI Responses");
    await click(protocolSelect());
    await waitFor(() => expect(document.querySelectorAll('[role="option"]').length).toBe(4));
    expect(
      Array.from(document.querySelectorAll('[role="option"]')).some((option) =>
        option.textContent?.includes("Unspecified"),
      ),
    ).toBe(false);
  });

  test("allows a legacy credential to explicitly declare its protocol without replacing the key", async () => {
    const capturedBodies = setupFetch([
      {
        apiBase: "https://custom.example.com/v1",
        id: CUSTOM_CREDENTIAL_ID,
        isDefault: true,
        maskedApiKey: "sk-***",
        modelProtocol: null,
        models: ["legacy-model"],
        name: "Legacy gateway",
        projectId: PROJECT_ID,
        vendorId: "openai-compatible",
      },
    ]);
    await renderProviders();
    await click(getButtonByLabel("Edit Legacy gateway key"));
    await selectProtocol("OpenAI Responses");
    await click(getButton("Save"));
    await waitFor(() => expect(queryDialog()).toBeNull());
    expect(
      capturedBodies.find((body) => body.query.includes("updateVendorCredential"))?.variables,
    ).toEqual({
      input: {
        apiBase: "https://custom.example.com/v1",
        id: CUSTOM_CREDENTIAL_ID,
        modelProtocol: "openai-responses",
        models: ["legacy-model"],
        name: "Legacy gateway",
        projectId: PROJECT_ID,
      },
    });
  });
});
