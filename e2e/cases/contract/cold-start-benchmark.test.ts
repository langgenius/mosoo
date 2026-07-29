import { describe, expect, test } from "bun:test";

import {
  createBalancedPairOrders,
  createColdStartPairPlans,
  parseRuntimeBenchmarkFixture,
  runColdStartSample,
  summarizeColdStartBenchmark,
  validateColdStartOutput,
} from "../../lib/cold-start-benchmark";
import type { BenchmarkVariant, ColdStartRunResult } from "../../lib/cold-start-benchmark";

function createRun(input: {
  readonly firstTextMs: number;
  readonly pair: number;
  readonly variant: BenchmarkVariant;
}): ColdStartRunResult {
  return {
    cfColo: "SIN",
    cfRayCreate: null,
    cfRaySend: null,
    cfRayStream: null,
    completedAt: "2026-07-19T00:00:01.000Z",
    failure: null,
    fixture: {
      agentConfigSha256: "agent-config-sha",
      agentId: "agent_test",
      model: "model-test",
      providerId: "provider-test",
      runtimeId: "runtime-test",
    },
    metrics: {
      assistantChunkCount: 10,
      assistantEventCount: 10,
      assistantTextCharacters: 200,
      createAcceptedMs: 100,
      firstAssistantTextMs: input.firstTextMs,
      intentToFirstAssistantTextMs: input.firstTextMs,
      intentToSendMs: 0,
      interChunkMaxMs: 20,
      interChunkP50Ms: 10,
      interChunkP95Ms: 20,
      pauseOver250MsCount: 0,
      pauseOver500MsCount: 0,
      runCompletedMs: input.firstTextMs + 500,
      sendToFirstAssistantTextMs: input.firstTextMs,
      streamConnectedMs: 120,
      streamFirstByteMs: 130,
      streamHandshakeMs: 20,
      usageTotalTokens: 300,
    },
    nonce: `NONCE_${input.pair}_${input.variant}`,
    crossoverPhase: 1,
    intentAt: "2026-07-19T00:00:00.000Z",
    journey: "one-shot",
    output: {
      expectedCanonicalCharacters: 400,
      integerCount: 120,
      nonceOccurrences: 1,
      reason: null,
      valid: true,
    },
    order: input.pair % 2 === 0 ? "ab" : "ba",
    pair: input.pair,
    phase: input.pair <= 15 ? 1 : 2,
    runId: `run_${input.pair}_${input.variant}`,
    sentAt: "2026-07-19T00:00:00.000Z",
    sequence: input.variant === "before" ? 1 : 2,
    stack: input.variant === "before" ? "a" : "b",
    startedAt: "2026-07-19T00:00:00.000Z",
    threadId: `thread_${input.pair}_${input.variant}`,
    variant: input.variant,
    workerVersionCreate: null,
    workerVersionSend: null,
    workerVersionStream: null,
  };
}

describe("cold-start benchmark contract", () => {
  test("counts multiple SSE events in one transport read as one visible delivery burst", async () => {
    let nonce = "";
    let firstTextObservation:
      | Parameters<NonNullable<Parameters<typeof runColdStartSample>[0]["onFirstAssistantText"]>>[0]
      | null = null;
    const encoder = new TextEncoder();
    const server = Bun.serve({
      fetch: async (request) => {
        const url = new URL(request.url);

        if (request.method === "POST" && url.pathname.endsWith("/threads")) {
          const body = (await request.json()) as {
            input: { content: Array<{ text: string }> };
          };
          nonce = /MOSOO_COLD_[A-Z0-9_]+/u.exec(body.input.content[0]?.text ?? "")?.[0] ?? "";
          return Response.json(
            { run: { id: "run_test" }, thread: { id: "thread_test" } },
            {
              headers: {
                "cf-ray": "create-SIN",
                "x-mosoo-worker-version": "worker-test",
              },
              status: 201,
            },
          );
        }

        if (url.pathname.endsWith("/events/stream")) {
          const event = (id: string, type: string, content: string) =>
            `event: thread.event\nid: ${id}\ndata: ${JSON.stringify({ content, id, tokens: null, type })}\n\n`;
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode(": connected\n\n"));
              setTimeout(() => {
                controller.enqueue(
                  encoder.encode(
                    event("event-1", "agent.message.delta", nonce) +
                      event(
                        "event-2",
                        "agent.message.delta",
                        `. ${Array.from({ length: 120 }, (_, index) => index + 1).join(",")}`,
                      ) +
                      event("event-3", "run.completed", ""),
                  ),
                );
                controller.close();
              }, 5);
            },
          });

          return new Response(stream, {
            headers: {
              "cf-ray": "stream-SIN",
              "content-type": "text/event-stream",
              "x-mosoo-worker-version": "worker-test",
            },
          });
        }

        return new Response(null, { status: 404 });
      },
      port: 0,
    });

    try {
      const result = await runColdStartSample({
        fixture: {
          agentConfigSha256: "agent-config-sha",
          agentId: "agent_test",
          appId: "app_test",
          baseURL: server.url.toString().replace(/\/$/u, ""),
          createdAt: "2026-07-19T00:00:00.000Z",
          model: "model-test",
          pat: "private-token",
          providerId: "provider-test",
          runtimeId: "runtime-test",
        },
        nonce: "MOSOO_COLD_1_BEFORE_TEST",
        onFirstAssistantText: (observation) => {
          firstTextObservation = observation;
        },
        plan: {
          order: "ab",
          pair: 1,
          phase: 1,
          sequence: 1,
          stack: "a",
          variant: "before",
        },
        timeoutMs: 1_000,
      });

      expect(result.failure).toBeNull();
      expect(result.cfColo).toBe("SIN");
      expect(result.metrics.assistantChunkCount).toBe(1);
      expect(result.metrics.assistantEventCount).toBe(2);
      expect(result.metrics.interChunkP95Ms).toBeNull();
      expect(result.metrics.assistantTextCharacters).toBeGreaterThan(20);
      expect(result.metrics.firstAssistantTextMs).toBeNumber();
      expect(result.metrics.runCompletedMs).toBeNumber();
      expect(result.journey).toBe("one-shot");
      expect(result.metrics.intentToSendMs).toBe(0);
      expect(result.runId).toBe("run_test");
      expect(result.workerVersionCreate).toBe("worker-test");
      expect(result.workerVersionSend).toBeNull();
      expect(result.workerVersionStream).toBe("worker-test");
      expect(firstTextObservation).toMatchObject({
        runId: "run_test",
        threadId: "thread_test",
        workerVersionCreate: "worker-test",
        workerVersionSend: null,
        workerVersionStream: "worker-test",
      });
    } finally {
      await server.stop(true);
    }
  });

  test("preconnects SSE and sends two-stage intent at the absolute lead deadline", async () => {
    const encoder = new TextEncoder();
    const nonce = "MOSOO_COLD_1_TWO_STAGE";
    const steps: string[] = [];
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const event = (id: string, type: string, content: string) =>
      `event: thread.event\nid: ${id}\ndata: ${JSON.stringify({ content, id, tokens: null, type })}\n\n`;
    const server = Bun.serve({
      async fetch(request) {
        const url = new URL(request.url);
        if (request.method === "POST" && url.pathname.endsWith("/threads")) {
          steps.push("create-empty");
          expect(await request.json()).toEqual({});
          return Response.json({ run: null, thread: { id: "thread-two-stage" } }, { status: 201 });
        }
        if (request.method === "GET" && url.pathname.endsWith("/events/stream")) {
          steps.push("stream-connected");
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                streamController = controller;
                controller.enqueue(encoder.encode(": connected\n\n"));
              },
            }),
            {
              headers: {
                "content-type": "text/event-stream",
                "x-mosoo-worker-version": "worker-two-stage",
              },
            },
          );
        }
        if (request.method === "POST" && url.pathname.endsWith("/events")) {
          steps.push("send-events");
          const answer = `${nonce}. ${Array.from({ length: 120 }, (_, index) => index + 1).join(",")}`;
          const split = Math.floor(answer.length / 2);
          streamController?.enqueue(
            encoder.encode(event("whitespace", "agent.message.delta", "  \n")),
          );
          await Bun.sleep(30);
          streamController?.enqueue(
            encoder.encode(event("answer-1", "agent.message.delta", answer.slice(0, split))),
          );
          await Bun.sleep(40);
          streamController?.enqueue(
            encoder.encode(event("answer-2", "agent.message.delta", answer.slice(split))),
          );
          streamController?.enqueue(encoder.encode(event("done", "run.completed", "")));
          streamController?.close();
          await Bun.sleep(250);
          return Response.json(
            { events: [{ run: { id: "run-two-stage" } }] },
            { headers: { "x-mosoo-worker-version": "worker-two-stage" } },
          );
        }
        return new Response(null, { status: 404 });
      },
      port: 0,
    });

    try {
      const result = await runColdStartSample({
        fixture: {
          agentConfigSha256: "agent-config-sha",
          agentId: "agent_test",
          appId: "app_test",
          baseURL: server.url.toString().replace(/\/$/u, ""),
          createdAt: "2026-07-19T00:00:00.000Z",
          model: "model-test",
          pat: "private-token",
          providerId: "provider-test",
          runtimeId: "runtime-test",
        },
        journey: "two-stage",
        leadMs: 20,
        nonce,
        plan: {
          order: "ab",
          pair: 1,
          phase: 1,
          sequence: 1,
          stack: "a",
          variant: "before",
        },
        timeoutMs: 1_000,
      });

      expect(steps).toEqual(["create-empty", "stream-connected", "send-events"]);
      expect(result.failure).toBeNull();
      expect(result.journey).toBe("two-stage");
      expect(result.crossoverPhase).toBe(1);
      expect(result.stack).toBe("a");
      expect(result.metrics.intentToSendMs).toBeGreaterThanOrEqual(15);
      expect(result.metrics.intentToFirstAssistantTextMs).toBeGreaterThanOrEqual(15);
      expect(result.metrics.sendToFirstAssistantTextMs).toBeNumber();
      expect(result.metrics.sendToFirstAssistantTextMs!).toBeGreaterThan(15);
      expect(result.metrics.sendToFirstAssistantTextMs!).toBeLessThan(150);
      expect(result.metrics.assistantChunkCount).toBe(2);
      expect(result.metrics.assistantEventCount).toBe(2);
      expect(result.metrics.interChunkP95Ms!).toBeGreaterThan(15);
      expect(result.metrics.interChunkP95Ms!).toBeLessThan(150);
      expect(result.workerVersionCreate).toBeNull();
      expect(result.workerVersionSend).toBe("worker-two-stage");
      expect(result.workerVersionStream).toBe("worker-two-stage");
    } finally {
      await server.stop(true);
    }
  });

  test("preserves the public run failure reason", async () => {
    const encoder = new TextEncoder();
    const server = Bun.serve({
      fetch(request) {
        const url = new URL(request.url);

        if (request.method === "POST" && url.pathname.endsWith("/threads")) {
          return Response.json(
            { run: { id: "run_failed" }, thread: { id: "thread_failed" } },
            { status: 201 },
          );
        }

        if (url.pathname.endsWith("/events/stream")) {
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(
                  encoder.encode(
                    'event: thread.event\nid: failed\ndata: {"content":"provider rejected request","id":"failed","tokens":null,"type":"run.failed"}\n\n',
                  ),
                );
                controller.close();
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          );
        }

        return new Response(null, { status: 404 });
      },
      port: 0,
    });

    try {
      const result = await runColdStartSample({
        fixture: {
          agentConfigSha256: "agent-config-sha",
          agentId: "agent_test",
          appId: "app_test",
          baseURL: server.url.toString().replace(/\/$/u, ""),
          createdAt: "2026-07-19T00:00:00.000Z",
          model: "model-test",
          pat: "private-token",
          providerId: "provider-test",
          runtimeId: "runtime-test",
        },
        nonce: "MOSOO_COLD_FAILURE_TEST",
        plan: {
          order: "ab",
          pair: 1,
          phase: 1,
          sequence: 1,
          stack: "a",
          variant: "before",
        },
        timeoutMs: 1_000,
      });

      expect(result.failure).toEqual({
        message: "Public API run emitted run.failed: provider rejected request",
        stage: "read_stream",
      });
    } finally {
      await server.stop(true);
    }
  });

  test("accepts only one nonce followed by the exact 1 through 120 sequence", () => {
    const nonce = "MOSOO_COLD_OUTPUT_TEST";
    const range = Array.from({ length: 120 }, (_, index) => String(index + 1)).join(",");
    const exact = `${nonce}. ${range}`;

    expect(validateColdStartOutput(exact, nonce)).toMatchObject({
      integerCount: 120,
      nonceOccurrences: 1,
      reason: null,
      valid: true,
    });
    expect(
      validateColdStartOutput(`\n  ${nonce}： ${range.replaceAll(",", "，")}． \n`, nonce),
    ).toMatchObject({ valid: true });
    expect(validateColdStartOutput(`${exact}${exact}`, nonce)).toMatchObject({
      reason: "nonce_occurrences",
      valid: false,
    });
    expect(validateColdStartOutput(`${nonce}. ${range},${range}`, nonce)).toMatchObject({
      reason: "integer_count",
      valid: false,
    });
    expect(
      validateColdStartOutput(`${nonce}. ${range.replace("60,61", "60,60")}`, nonce),
    ).toMatchObject({
      reason: "integer_sequence",
      valid: false,
    });
    expect(validateColdStartOutput(`${nonce}. ${range}\nDone.`, nonce)).toMatchObject({
      reason: "range_format",
      valid: false,
    });
  });

  test("fails a stream that appends the authoritative full snapshot twice", async () => {
    const nonce = "MOSOO_COLD_DUPLICATE_TEST";
    const answer = `${nonce}. ${Array.from({ length: 120 }, (_, index) => index + 1).join(",")}`;
    const encoder = new TextEncoder();
    const server = Bun.serve({
      fetch(request) {
        const url = new URL(request.url);

        if (request.method === "POST" && url.pathname.endsWith("/threads")) {
          return Response.json(
            { run: { id: "run_duplicate" }, thread: { id: "thread_duplicate" } },
            { status: 201 },
          );
        }

        if (url.pathname.endsWith("/events/stream")) {
          const event = (id: string, type: string, content: string) =>
            `event: thread.event\nid: ${id}\ndata: ${JSON.stringify({ content, id, tokens: null, type })}\n\n`;
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(encoder.encode(event("delta", "agent.message.delta", answer)));
                controller.enqueue(
                  encoder.encode(event("snapshot", "agent.message.delta", answer)),
                );
                controller.enqueue(encoder.encode(event("terminal", "run.completed", "")));
                controller.close();
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          );
        }

        return new Response(null, { status: 404 });
      },
      port: 0,
    });

    try {
      const result = await runColdStartSample({
        fixture: {
          agentConfigSha256: "agent-config-sha",
          agentId: "agent_test",
          appId: "app_test",
          baseURL: server.url.toString().replace(/\/$/u, ""),
          createdAt: "2026-07-19T00:00:00.000Z",
          model: "model-test",
          pat: "private-token",
          providerId: "provider-test",
          runtimeId: "runtime-test",
        },
        nonce,
        plan: {
          order: "ab",
          pair: 1,
          phase: 1,
          sequence: 1,
          stack: "a",
          variant: "before",
        },
        timeoutMs: 1_000,
      });

      expect(result.metrics.assistantTextCharacters).toBe(answer.length * 2);
      expect(result.output).toMatchObject({
        nonceOccurrences: 2,
        reason: "nonce_occurrences",
        valid: false,
      });
      expect(result.failure).toMatchObject({ stage: "validate_output" });
    } finally {
      await server.stop(true);
    }
  });

  test("returns at the hard deadline when an SSE reader never completes", async () => {
    const encoder = new TextEncoder();
    const server = Bun.serve({
      fetch: (request) => {
        const url = new URL(request.url);

        if (request.method === "POST" && url.pathname.endsWith("/threads")) {
          return Response.json(
            { run: { id: "run_hung" }, thread: { id: "thread_hung" } },
            { status: 201 },
          );
        }

        if (url.pathname.endsWith("/events/stream")) {
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(encoder.encode(": connected\n\n"));
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          );
        }

        return new Response(null, { status: 404 });
      },
      port: 0,
    });

    try {
      const startedAt = performance.now();
      const result = await runColdStartSample({
        fixture: {
          agentConfigSha256: "agent-config-sha",
          agentId: "agent_test",
          appId: "app_test",
          baseURL: server.url.toString().replace(/\/$/u, ""),
          createdAt: "2026-07-19T00:00:00.000Z",
          model: "model-test",
          pat: "private-token",
          providerId: "provider-test",
          runtimeId: "runtime-test",
        },
        nonce: "MOSOO_COLD_TIMEOUT_TEST",
        plan: {
          order: "ab",
          pair: 1,
          phase: 1,
          sequence: 1,
          stack: "a",
          variant: "before",
        },
        timeoutMs: 25,
      });

      expect(performance.now() - startedAt).toBeLessThan(500);
      expect(result.failure).toEqual({
        message: "Cold-start sample timed out after 25ms.",
        stage: "read_stream",
      });
    } finally {
      await server.stop(true);
    }
  });

  test("creates a deterministic, exactly balanced 30-pair order", () => {
    const first = createBalancedPairOrders(30, "seed-a");
    const second = createBalancedPairOrders(30, "seed-a");

    expect(first).toEqual(second);
    expect(first.filter((order) => order === "ab")).toHaveLength(15);
    expect(first.filter((order) => order === "ba")).toHaveLength(15);
  });

  test("maps physical stacks to crossed variants without changing global pair numbers", () => {
    const phaseOne = createColdStartPairPlans({
      pairCount: 15,
      pairStart: 0,
      phase: 1,
      seed: "seed-a",
      stackVariants: { a: "before", b: "after" },
      totalPairs: 30,
    });
    const phaseTwo = createColdStartPairPlans({
      pairCount: 15,
      pairStart: 15,
      phase: 2,
      seed: "seed-a",
      stackVariants: { a: "after", b: "before" },
      totalPairs: 30,
    });

    expect(phaseOne[0]?.pair).toBe(1);
    expect(phaseOne.at(-1)?.pair).toBe(15);
    expect(phaseTwo[0]?.pair).toBe(16);
    expect(phaseTwo.at(-1)?.pair).toBe(30);

    for (const pair of [...phaseOne, ...phaseTwo]) {
      expect(pair.runs.map((run) => run.variant).toSorted()).toEqual(["after", "before"]);
      expect(pair.runs.map((run) => run.stack).toSorted()).toEqual(["a", "b"]);
    }
  });

  test("retains only a complete material improvement with a negative paired CI", () => {
    const runs = Array.from({ length: 30 }, (_, index) => index + 1).flatMap((pair) => [
      createRun({ firstTextMs: 1_000 + pair, pair, variant: "before" }),
      createRun({ firstTextMs: 600 + pair, pair, variant: "after" }),
    ]);
    const summary = summarizeColdStartBenchmark(runs, "seed-a");

    expect(summary.pairedFirstAssistantText.completePairs).toBe(30);
    expect(summary.pairedFirstAssistantText.medianAfterMinusBeforeMs).toBe(-400);
    expect(summary.pairedFirstAssistantText.bootstrapMedianDeltaCi95).toEqual([-400, -400]);
    expect(summary.gate).toEqual({
      bootstrapCiExcludesZero: true,
      failureRateNotWorse: true,
      medianImprovementAtLeast20Percent: true,
      minimumThirtyPairs: true,
      p95NotWorse: true,
      retain: true,
    });
  });

  test("retains a proven improvement smaller than 20 percent", () => {
    const runs = Array.from({ length: 30 }, (_, index) => index + 1).flatMap((pair) => [
      createRun({ firstTextMs: 1_000 + pair, pair, variant: "before" }),
      createRun({ firstTextMs: 900 + pair, pair, variant: "after" }),
    ]);
    const summary = summarizeColdStartBenchmark(runs, "seed-a");

    expect(summary.gate.medianImprovementAtLeast20Percent).toBeFalse();
    expect(summary.gate.bootstrapCiExcludesZero).toBeTrue();
    expect(summary.gate.retain).toBeTrue();
  });

  test("does not declare success from an incomplete experiment", () => {
    const summary = summarizeColdStartBenchmark(
      [
        createRun({ firstTextMs: 1_000, pair: 1, variant: "before" }),
        createRun({ firstTextMs: 500, pair: 1, variant: "after" }),
      ],
      "seed-a",
    );

    expect(summary.gate.minimumThirtyPairs).toBeFalse();
    expect(summary.gate.retain).toBeFalse();
  });

  test("validates secret fixtures without projecting the PAT into benchmark metadata", () => {
    const fixture = parseRuntimeBenchmarkFixture({
      agentConfigSha256: "agent-config-sha",
      agentId: "agent_test",
      appId: "app_test",
      baseURL: "https://stage.example.com/",
      createdAt: "2026-07-19T00:00:00.000Z",
      model: "model-test",
      pat: "private-token",
      providerId: "provider-test",
      runtimeId: "runtime-test",
    });

    expect(fixture.baseURL).toBe("https://stage.example.com");
    expect(fixture.pat).toBe("private-token");
    expect(() => parseRuntimeBenchmarkFixture({ baseURL: "file:///tmp/test" })).toThrow();
  });
});
