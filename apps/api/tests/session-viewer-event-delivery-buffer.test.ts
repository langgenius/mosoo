import { describe, expect, test } from "bun:test";

import { createServerCustomEvent, MOSOO_CUSTOM_EVENT } from "@mosoo/ag-ui-session";
import type { AgUiSessionEvent } from "@mosoo/ag-ui-session";

import { SessionViewerEventDeliveryBuffer } from "../src/modules/runtime/infrastructure/driver-instance/session-viewer-event-delivery-buffer";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";

interface Deferred<T> {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T) => void;
}

interface PublishedRequest {
  events: AgUiSessionEvent[];
  sessionId: string;
}

function createDeferred<T>(): Deferred<T> {
  let rejectDeferred: (reason?: unknown) => void = () => {};
  let resolveDeferred: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    rejectDeferred = reject;
    resolveDeferred = resolve;
  });

  return {
    promise,
    reject: rejectDeferred,
    resolve: resolveDeferred,
  };
}

function createBufferHarness(): {
  buffer: SessionViewerEventDeliveryBuffer;
  published: PublishedRequest[];
  pushResponse: (response: Promise<Response> | Response) => void;
  waitForPublish: () => Promise<void>;
  waitForWaitUntil: () => Promise<void>;
} {
  const publishWaiters: Array<() => void> = [];
  const published: PublishedRequest[] = [];
  const responses: Array<Promise<Response> | Response> = [];
  const waitUntilTasks: Promise<void>[] = [];
  const sessionStub = {
    async publishEvents(sessionId: string, events: AgUiSessionEvent[]): Promise<void> {
      published.push({
        events,
        sessionId,
      });
      publishWaiters.shift()?.();

      const response = await (responses.shift() ?? new Response(null, { status: 204 }));

      if (!response.ok) {
        throw new Error(`Session event publish failed with status ${response.status}.`);
      }
    },
  };
  const env = {
    Session: {
      get: () => sessionStub,
      idFromName: (name: string) => name,
    },
  } as ApiBindings;
  const ctx = {
    waitUntil: (task: Promise<void>) => {
      waitUntilTasks.push(task);
    },
  } as DurableObjectState;
  const buffer = new SessionViewerEventDeliveryBuffer({
    ctx,
    env,
    getDriverInstanceId: () => "driver-1",
    withRuntimeLogContext: (fn) => fn(),
  });

  return {
    buffer,
    published,
    pushResponse: (response) => {
      responses.push(response);
    },
    waitForPublish: () =>
      new Promise((resolve) => {
        publishWaiters.push(resolve);
      }),
    waitForWaitUntil: async () => {
      const tasks = waitUntilTasks.splice(0);
      const results = await Promise.allSettled(tasks);
      const rejected = results.find((result) => result.status === "rejected");

      if (rejected?.status === "rejected") {
        throw rejected.reason;
      }
    },
  };
}

describe("SessionViewerEventDeliveryBuffer", () => {
  test("flushes compacted text payloads", async () => {
    const { buffer, published } = createBufferHarness();
    const events: AgUiSessionEvent[] = Array.from({ length: 3 }, () => ({
      delta: "x",
      messageId: "assistant-1",
      type: "TEXT_MESSAGE_CONTENT",
    }));

    buffer.enqueue("session-1", events);
    await buffer.flush();

    expect(published).toEqual([
      {
        events: [
          {
            delta: "xxx",
            messageId: "assistant-1",
            type: "TEXT_MESSAGE_CONTENT",
          },
        ],
        sessionId: "session-1",
      },
    ]);
  });

  test("flushes state delta payloads", async () => {
    const { buffer, published } = createBufferHarness();
    const events: AgUiSessionEvent[] = Array.from({ length: 2 }, (_, index) => ({
      delta: [{ op: "replace", path: `/commands/${index}`, value: null }],
      type: "STATE_DELTA",
    }));

    buffer.enqueue("session-1", events);
    await buffer.flush();

    expect(published[0]?.events).toHaveLength(2);
  });

  test("flushes terminal events immediately", async () => {
    const { buffer, published, waitForWaitUntil } = createBufferHarness();
    const terminalEvent = createServerCustomEvent(MOSOO_CUSTOM_EVENT.sessionRunUpdated.name, {
      lifecycle: "IDLE",
      run: {
        completedAt: "2026-04-30T00:00:01.000Z",
        error: null,
        id: "run-1",
        startedAt: "2026-04-30T00:00:00.000Z",
        status: "completed",
        traceId: null,
      },
    });

    buffer.enqueue("session-1", [
      { delta: "done", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" },
      terminalEvent,
    ]);
    await waitForWaitUntil();

    expect(published[0]?.events).toEqual([
      { delta: "done", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" },
      terminalEvent,
    ]);
  });

  test("requeues failed deliveries before events enqueued during the failed publish", async () => {
    const { buffer, published, pushResponse, waitForPublish } = createBufferHarness();
    const failedResponse = createDeferred<Response>();
    pushResponse(failedResponse.promise);

    buffer.enqueue("session-1", [
      { delta: "A", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" },
    ]);
    const firstPublish = waitForPublish();
    const failedFlush = buffer.flush().catch((error: unknown) => error);
    await firstPublish;

    buffer.enqueue("session-1", [
      { delta: "B", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" },
    ]);
    failedResponse.resolve(
      new Response(JSON.stringify({ error: "publish failed" }), {
        headers: { "content-type": "application/json" },
        status: 500,
      }),
    );

    expect(await failedFlush).toBeInstanceOf(Error);
    await buffer.flush();

    expect(published).toEqual([
      {
        events: [{ delta: "A", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" }],
        sessionId: "session-1",
      },
      {
        events: [{ delta: "AB", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" }],
        sessionId: "session-1",
      },
    ]);
  });
});
