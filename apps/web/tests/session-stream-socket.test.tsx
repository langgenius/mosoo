import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { JSDOM } from "jsdom";
import { act } from "react";
import type { Root } from "react-dom/client";

import { useSessionStreamSocket } from "../src/domains/runtime/session-stream/session-stream-socket";

class TestWebSocket {
  public static readonly CLOSED = 3;
  public static readonly CLOSING = 2;
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly instances: TestWebSocket[] = [];

  readonly #listeners = new Map<string, Set<() => void>>();
  public readyState = TestWebSocket.CONNECTING;

  public constructor(public readonly url: string) {
    TestWebSocket.instances.push(this);
  }

  public addEventListener(type: string, listener: () => void): void {
    const listeners = this.#listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  public close(): void {
    this.readyState = TestWebSocket.CLOSED;
    for (const listener of this.#listeners.get("close") ?? []) {
      listener();
    }
  }

  public disconnect(): void {
    this.close();
  }

  public send(): void {}
}

let dom: JSDOM;
let root: Root | null = null;
let pendingFrames: Set<number>;

function Harness(): null {
  useSessionStreamSocket("app-1", "session-1");
  return null;
}

beforeEach(() => {
  dom = new JSDOM("<!doctype html><html><body><div id=app></div></body></html>", {
    url: "http://localhost/session-1",
  });
  pendingFrames = new Set();
  TestWebSocket.instances.length = 0;

  Object.defineProperties(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
    WebSocket: { configurable: true, value: TestWebSocket },
    document: { configurable: true, value: dom.window.document },
    location: { configurable: true, value: dom.window.location },
    window: { configurable: true, value: dom.window },
  });
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.requestAnimationFrame = () => {
    const handle = pendingFrames.size + 1;
    pendingFrames.add(handle);
    return handle;
  };
  globalThis.cancelAnimationFrame = (handle) => {
    pendingFrames.delete(handle);
  };
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => {
      root?.unmount();
    });
  }

  root = null;
  dom.window.close();
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.location;
  delete globalThis.HTMLElement;
  delete globalThis.Node;
  delete globalThis.requestAnimationFrame;
  delete globalThis.cancelAnimationFrame;
  delete (globalThis as { WebSocket?: unknown }).WebSocket;
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: undefined,
  });
});

describe("session stream socket", () => {
  test("cancels reconnect and rendering work after an unmount", async () => {
    const { createRoot } = await import("react-dom/client");
    const container = document.querySelector("#app");

    if (!(container instanceof HTMLElement)) {
      throw new Error("Expected the test root element.");
    }

    root = createRoot(container);
    await act(async () => {
      root?.render(<Harness />);
    });

    expect(TestWebSocket.instances).toHaveLength(1);

    await act(async () => {
      TestWebSocket.instances[0]?.disconnect();
      root?.unmount();
    });
    root = null;

    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(TestWebSocket.instances).toHaveLength(1);
    expect(pendingFrames).toHaveLength(0);
  });
});
