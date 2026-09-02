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
  previousRuntimeEventSeqCursor?: number;
  runtimeEventSeqCursor?: number;
  sessionId: string;
}

const largeTaskMetadata = "x".repeat(4_096);
const maxSerializedBatchBytes = 1_536 * 1024;

function createLargeTaskSnapshot(input: {
  driverInstanceId: string;
  marker: string;
  runId: string;
}): AgUiSessionEvent {
  return createServerCustomEvent(MOSOO_CUSTOM_EVENT.sessionTasksReplaced.name, {
    driverInstanceId: input.driverInstanceId,
    runId: input.runId,
    tasks: Array.from({ length: 120 }, (_, index) => ({
      taskId: `${input.marker}-${index}`,
      taskType: largeTaskMetadata,
      title: largeTaskMetadata,
    })),
  });
}

function createTerminalEvent(runId = "run-1"): AgUiSessionEvent {
  return createServerCustomEvent(MOSOO_CUSTOM_EVENT.sessionRunUpdated.name, {
    driverInstanceId: null,
    lifecycle: "IDLE",
    run: {
      completedAt: "2026-04-30T00:00:01.000Z",
      error: null,
      id: runId,
      startedAt: "2026-04-30T00:00:00.000Z",
      status: "completed",
      traceId: null,
    },
  });
}

function serializedEventBytes(events: AgUiSessionEvent[]): number {
  return new TextEncoder().encode(JSON.stringify(events)).byteLength;
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
  batchPublishCount: () => number;
  buffer: SessionViewerEventDeliveryBuffer;
  published: PublishedRequest[];
  pushAfterResponse: (callback: () => void) => void;
  pushResponse: (response: Promise<Response> | Response) => void;
  stateSyncCount: () => number;
  waitForPublish: () => Promise<void>;
  waitForWaitUntil: () => Promise<void>;
} {
  const publishWaiters: Array<() => void> = [];
  const published: PublishedRequest[] = [];
  const afterResponseCallbacks: Array<() => void> = [];
  const responses: Array<Promise<Response> | Response> = [];
  const waitUntilTasks: Promise<void>[] = [];
  let batchPublishCount = 0;
  let stateSyncCount = 0;
  const sessionStub = {
    async publishEventBatches(
      sessionId: string,
      batches: Array<{
        events: AgUiSessionEvent[];
        previousRuntimeEventSeqCursor: number | null;
        runtimeEventSeqCursor: number | null;
      }>,
    ): Promise<void> {
      batchPublishCount += 1;
      for (const batch of batches) {
        published.push({
          events: batch.events,
          ...(batch.previousRuntimeEventSeqCursor === null
            ? {}
            : { previousRuntimeEventSeqCursor: batch.previousRuntimeEventSeqCursor }),
          ...(batch.runtimeEventSeqCursor === null
            ? {}
            : { runtimeEventSeqCursor: batch.runtimeEventSeqCursor }),
          sessionId,
        });
      }
      publishWaiters.shift()?.();
      const response = await (responses.shift() ?? new Response(null, { status: 204 }));
      if (!response.ok) {
        throw new Error(`Session event publish failed with status ${response.status}.`);
      }
      afterResponseCallbacks.shift()?.();
    },
    async publishEvents(
      sessionId: string,
      events: AgUiSessionEvent[],
      runtimeEventSeqCursor: number | null,
      previousRuntimeEventSeqCursor: number | null,
    ): Promise<void> {
      published.push({
        events,
        ...(previousRuntimeEventSeqCursor === null ? {} : { previousRuntimeEventSeqCursor }),
        ...(runtimeEventSeqCursor === null ? {} : { runtimeEventSeqCursor }),
        sessionId,
      });
      publishWaiters.shift()?.();

      const response = await (responses.shift() ?? new Response(null, { status: 204 }));

      if (!response.ok) {
        throw new Error(`Session event publish failed with status ${response.status}.`);
      }

      afterResponseCallbacks.shift()?.();
    },
    async syncViewers(): Promise<void> {
      stateSyncCount += 1;
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
    batchPublishCount: () => batchPublishCount,
    buffer,
    published,
    pushAfterResponse: (callback) => {
      afterResponseCallbacks.push(callback);
    },
    pushResponse: (response) => {
      responses.push(response);
    },
    stateSyncCount: () => stateSyncCount,
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
    const terminalEvent = createTerminalEvent();

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

  test("keeps a delayed flush alive until the buffered events are published", async () => {
    const { buffer, published, waitForWaitUntil } = createBufferHarness();

    buffer.enqueue("session-1", [
      { delta: "batched", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" },
    ]);
    await waitForWaitUntil();

    expect(published).toEqual([
      {
        events: [{ delta: "batched", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" }],
        sessionId: "session-1",
      },
    ]);
  });

  test("keeps different durable cursor generations in separate deliveries", async () => {
    const { batchPublishCount, buffer, published } = createBufferHarness();

    buffer.enqueue(
      "session-1",
      [{ delta: "one", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" }],
      1,
      0,
    );
    buffer.enqueue(
      "session-1",
      [{ delta: "two", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" }],
      2,
      1,
    );
    await buffer.flush();

    expect(batchPublishCount()).toBe(1);
    expect(
      published.map(({ events, previousRuntimeEventSeqCursor, runtimeEventSeqCursor }) => ({
        events,
        previousRuntimeEventSeqCursor,
        runtimeEventSeqCursor,
      })),
    ).toEqual([
      {
        events: [{ delta: "one", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" }],
        previousRuntimeEventSeqCursor: 0,
        runtimeEventSeqCursor: 1,
      },
      {
        events: [{ delta: "two", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" }],
        previousRuntimeEventSeqCursor: 1,
        runtimeEventSeqCursor: 2,
      },
    ]);
  });

  test("keeps one durable cursor generation in one atomic delivery", async () => {
    const { batchPublishCount, buffer, published } = createBufferHarness();
    const events: AgUiSessionEvent[] = Array.from({ length: 128 }, (_, index) => ({
      delta: [{ op: "replace", path: `/commands/${index}`, value: index }],
      type: "STATE_DELTA",
    }));

    buffer.enqueue("session-1", events, 128, 0);
    await buffer.flush();

    expect(batchPublishCount()).toBe(1);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      events,
      previousRuntimeEventSeqCursor: 0,
      runtimeEventSeqCursor: 128,
    });
  });

  test("falls back to an authoritative state sync for an oversized durable generation", async () => {
    const { batchPublishCount, buffer, published, stateSyncCount } = createBufferHarness();
    const oversized = createServerCustomEvent(MOSOO_CUSTOM_EVENT.sessionTasksReplaced.name, {
      driverInstanceId: "driver-1",
      runId: "run-1",
      tasks: [{ taskId: "oversized", title: "x".repeat(maxSerializedBatchBytes + 1) }],
    });

    buffer.enqueue("session-1", [oversized], 1, 0);
    await buffer.flush();

    expect(batchPublishCount()).toBe(0);
    expect(published).toEqual([]);
    expect(stateSyncCount()).toBe(1);
  });

  test("flushes the first delta of a run immediately, then batches the rest", async () => {
    const { buffer, published, waitForWaitUntil } = createBufferHarness();
    const runStarted = {
      input: null,
      parentRunId: null,
      runId: "run-1",
      threadId: "thread-1",
      type: "RUN_STARTED",
    } satisfies AgUiSessionEvent;

    // RUN_STARTED + first delta: must publish without an explicit flush() —
    // i.e. it bypassed the 150ms timer.
    buffer.enqueue("session-1", [
      runStarted,
      { delta: "hi", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" },
    ]);
    await waitForWaitUntil();

    expect(published).toHaveLength(1);
    expect(published[0]?.events).toContainEqual({
      delta: "hi",
      messageId: "assistant-1",
      type: "TEXT_MESSAGE_CONTENT",
    });

    // A subsequent small delta must NOT flush immediately (batching preserved):
    // nothing new is published until an explicit flush.
    buffer.enqueue("session-1", [
      { delta: "there", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" },
    ]);
    expect(published).toHaveLength(1);

    await buffer.flush();
    expect(published).toHaveLength(2);
  });

  test("does not strand a terminal batch queued as the prior delivery settles", async () => {
    const { buffer, published, pushAfterResponse, waitForWaitUntil } = createBufferHarness();
    const terminalEvent = createTerminalEvent();

    pushAfterResponse(() => {
      // Cross the Session stub, client, and drain continuations so this lands
      // after the drain resolves but before a chained cleanup reaction can run.
      queueMicrotask(() => {
        queueMicrotask(() => {
          queueMicrotask(() => {
            buffer.enqueue("session-1", [terminalEvent]);
          });
        });
      });
    });
    buffer.enqueue("session-1", [
      { delta: "done", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" },
    ]);
    await buffer.flush();
    await waitForWaitUntil();

    expect(published.map((request) => request.events)).toEqual([
      [{ delta: "done", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" }],
      [terminalEvent],
    ]);
  });

  test("coalesces a same-generation large task snapshot flood to the latest event", async () => {
    const { buffer, published } = createBufferHarness();
    let latestSnapshot: AgUiSessionEvent | null = null;

    for (let index = 0; index < 34; index += 1) {
      latestSnapshot = createLargeTaskSnapshot({
        driverInstanceId: "driver-1",
        marker: `snapshot-${index}`,
        runId: "run-1",
      });
      buffer.enqueue("session-1", [latestSnapshot]);
    }
    await buffer.flush();

    expect(published).toHaveLength(1);
    expect(published[0]?.events).toEqual([latestSnapshot]);
  });

  test("keeps only the in-flight and latest same-generation snapshot during a slow publish", async () => {
    const { buffer, published, pushResponse, waitForPublish } = createBufferHarness();
    const response = createDeferred<Response>();
    const inFlightSnapshot = createLargeTaskSnapshot({
      driverInstanceId: "driver-1",
      marker: "in-flight",
      runId: "run-1",
    });
    const pendingSnapshots = Array.from({ length: 5 }, (_, index) =>
      createLargeTaskSnapshot({
        driverInstanceId: "driver-1",
        marker: `pending-${index}`,
        runId: "run-1",
      }),
    );
    pushResponse(response.promise);

    buffer.enqueue("session-1", [inFlightSnapshot]);
    const firstPublish = waitForPublish();
    const flush = buffer.flush();
    await firstPublish;

    for (const [index, snapshot] of pendingSnapshots.entries()) {
      buffer.enqueue("session-1", [snapshot, createTerminalEvent(`terminal-${index}`)]);
    }

    expect(published.map((request) => request.events)).toEqual([[inFlightSnapshot]]);

    response.resolve(new Response(null, { status: 204 }));
    await flush;

    const deliveredSnapshots = published
      .flatMap((request) => request.events)
      .filter(
        (event) =>
          event.type === "CUSTOM" && event.name === MOSOO_CUSTOM_EVENT.sessionTasksReplaced.name,
      );
    expect(deliveredSnapshots).toEqual([inFlightSnapshot, pendingSnapshots.at(-1)]);
  });

  test("bounds a cross-generation backlog behind one authoritative state sync", async () => {
    const { buffer, published, stateSyncCount } = createBufferHarness();
    const snapshots = Array.from({ length: 3 }, (_, index) =>
      createLargeTaskSnapshot({
        driverInstanceId: `driver-${index}`,
        marker: `snapshot-${index}`,
        runId: `run-${index}`,
      }),
    );

    buffer.enqueue("session-1", [snapshots[0]]);
    expect(published).toHaveLength(0);
    buffer.enqueue("session-1", [snapshots[1]]);
    expect(published[0]?.events).toEqual([snapshots[0]]);
    buffer.enqueue("session-1", [snapshots[2]]);
    await buffer.flush();

    expect(published).toHaveLength(1);
    expect(published.map((request) => request.events.length)).toEqual([1]);
    expect(
      published.every((request) => serializedEventBytes(request.events) <= maxSerializedBatchBytes),
    ).toBe(true);
    expect(stateSyncCount()).toBe(1);
  });

  test("retries failed bounded batches before events enqueued during the failed publish", async () => {
    const { buffer, published, pushResponse, stateSyncCount, waitForPublish } =
      createBufferHarness();
    const failedResponse = createDeferred<Response>();
    const failedSnapshot = createLargeTaskSnapshot({
      driverInstanceId: "driver-1",
      marker: "failed",
      runId: "run-1",
    });
    const nextSnapshot = createLargeTaskSnapshot({
      driverInstanceId: "driver-2",
      marker: "next",
      runId: "run-2",
    });
    pushResponse(failedResponse.promise);

    buffer.enqueue("session-1", [failedSnapshot]);
    const firstPublish = waitForPublish();
    const failedFlush = buffer.flush().catch((error: unknown) => error);
    await firstPublish;

    buffer.enqueue("session-1", [nextSnapshot]);
    failedResponse.resolve(
      new Response(JSON.stringify({ error: "publish failed" }), {
        headers: { "content-type": "application/json" },
        status: 500,
      }),
    );

    expect(await failedFlush).toBeInstanceOf(Error);
    await buffer.flush();

    expect(published.map((request) => request.events)).toEqual([
      [failedSnapshot],
      [failedSnapshot],
    ]);
    expect(stateSyncCount()).toBe(1);
    expect(
      published.every((request) => serializedEventBytes(request.events) <= maxSerializedBatchBytes),
    ).toBe(true);
  });

  test("drops derived payloads after delivery failure instead of hot-looping", async () => {
    const { buffer, published, pushResponse } = createBufferHarness();
    const snapshots = Array.from({ length: 5 }, (_, index) =>
      createLargeTaskSnapshot({
        driverInstanceId: "driver-1",
        marker: `snapshot-${index}`,
        runId: "run-1",
      }),
    );

    for (const snapshot of snapshots) {
      pushResponse(new Response(null, { status: 500 }));
      buffer.enqueue("session-1", [snapshot]);
      await buffer.flushSafely();
    }
    await buffer.flush();

    expect(published.map((request) => request.events)).toEqual([
      [snapshots[0]],
      [snapshots[1]],
      [snapshots[2]],
      [snapshots[3]],
      [snapshots[4]],
    ]);
    expect(
      published.every((request) => serializedEventBytes(request.events) <= maxSerializedBatchBytes),
    ).toBe(true);
  });
});
