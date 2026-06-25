import { describe, expect, test } from "bun:test";

import type {
  PublicThreadApiCreateThreadResponse,
  PublicThreadApiListThreadEventsResponse,
  PublicThreadApiRetrieveThreadResponse,
  PublicThreadEventLogEntry,
} from "@mosoo/contracts/public-api";
import type { MosooPublicApiError } from "@mosoo/public-api-client";
import { MosooPublicThreadClient } from "@mosoo/public-api-client";
import { extractFinalOutput } from "@mosoo/public-api-client";

interface RecordedRequest {
  body: unknown;
  headers: Headers;
  method: string;
  url: string;
}

const THREAD_ID = "01J00000000000000000000009";
const RUN_ID = "01J0000000000000000000000A";

function threadResponse(status: "RUNNING" | "IDLE" = "RUNNING") {
  return {
    agent_id: "01J00000000000000000000001",
    attributed_user: { id: "01J00000000000000000000002" },
    client_external_ref: "demo-thread-001",
    created_at: "2026-05-19T00:00:00.000Z",
    created_by: { id: "01J00000000000000000000002", kind: "access_token" },
    id: THREAD_ID,
    kind: "pet",
    last_run_id: RUN_ID,
    source: "api",
    status,
    title: "Say hello",
    updated_at: "2026-05-19T00:00:01.000Z",
  } as const;
}

function runResponse(status: "completed" | "running" = "running") {
  return {
    completedAt: status === "completed" ? "2026-05-19T00:00:02.000Z" : null,
    createdAt: "2026-05-19T00:00:00.000Z",
    error: null,
    finalOutput: null,
    id: RUN_ID,
    startedAt: "2026-05-19T00:00:01.000Z",
    status,
    trigger: "user_prompt",
    updatedAt: "2026-05-19T00:00:02.000Z",
  } as const;
}

async function readRequestBody(request: Request): Promise<unknown> {
  const text = await request.text();

  return text.length === 0 ? null : JSON.parse(text);
}

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

describe("MosooPublicThreadClient", () => {
  test("creates a Thread, waits for completion, and reconstructs final output by run", async () => {
    const requests: RecordedRequest[] = [];
    const fetchMock: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push({
        body: await readRequestBody(request.clone()),
        headers: request.headers,
        method: request.method,
        url: request.url,
      });

      if (request.method === "POST" && request.url.endsWith("/agents/agent-1/threads")) {
        return jsonResponse(
          {
            links: { thread: `/api/v1/threads/${THREAD_ID}` },
            run: runResponse("running"),
            thread: threadResponse(),
          } satisfies PublicThreadApiCreateThreadResponse,
          201,
        );
      }

      if (request.method === "GET" && request.url.endsWith(`/threads/${THREAD_ID}`)) {
        return jsonResponse({
          links: { thread: `/api/v1/threads/${THREAD_ID}` },
          run: runResponse("completed"),
          thread: threadResponse("IDLE"),
        } satisfies PublicThreadApiRetrieveThreadResponse);
      }

      if (request.method === "GET" && request.url.includes(`/threads/${THREAD_ID}/events`)) {
        return jsonResponse({
          events: [
            {
              content: "Old output",
              durationMs: 0,
              id: "01J00000000000000000000010",
              occurredAt: "2026-05-19T00:00:00.000Z",
              runId: "01J0000000000000000000000B",
              status: "available",
              tokens: null,
              type: "agent.message.delta",
            },
            {
              content: "Hello ",
              durationMs: 0,
              id: "01J00000000000000000000011",
              occurredAt: "2026-05-19T00:00:01.000Z",
              runId: RUN_ID,
              status: "available",
              tokens: null,
              type: "agent.message.delta",
            },
            {
              content: "from Mosoo",
              durationMs: 0,
              id: "01J00000000000000000000012",
              occurredAt: "2026-05-19T00:00:02.000Z",
              runId: RUN_ID,
              status: "available",
              tokens: null,
              type: "agent.message.delta",
            },
          ],
          truncated: false,
        } satisfies PublicThreadApiListThreadEventsResponse);
      }

      return jsonResponse({ error: { code: "not_found", message: "Not found." } }, 404);
    };

    const client = new MosooPublicThreadClient({
      baseUrl: "https://api.example.com",
      fetch: fetchMock,
      token: "mst_test",
    });
    const result = await client.createThreadAndWait({
      agentId: "agent-1",
      idempotencyKey: "thread-create-1",
      input: "Say hello from the API.",
      timeoutMs: 1_000,
    });

    expect(result.finalOutput).toEqual({ text: "Hello from Mosoo" });
    expect(result.run.finalOutput).toEqual({ text: "Hello from Mosoo" });
    expect(requests[0]?.headers.get("Authorization")).toBe("Bearer mst_test");
    expect(requests[0]?.headers.get("Idempotency-Key")).toBe("thread-create-1");
    expect(requests[0]?.body).toEqual({
      input: {
        content: [{ text: "Say hello from the API.", type: "text" }],
        type: "user.message",
      },
    });
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/api/v1/agents/agent-1/threads",
      `/api/v1/threads/${THREAD_ID}`,
      `/api/v1/threads/${THREAD_ID}/events`,
    ]);
  });

  test("extracts final output from one run without duplicating other events", () => {
    expect(
      extractFinalOutput(
        [
          {
            content: "first",
            durationMs: 0,
            id: "01J00000000000000000000010",
            occurredAt: "2026-05-19T00:00:00.000Z",
            runId: RUN_ID,
            status: "available",
            tokens: null,
            type: "agent.message.delta",
          },
          {
            content: "ignored",
            durationMs: 0,
            id: "01J00000000000000000000011",
            occurredAt: "2026-05-19T00:00:01.000Z",
            runId: "01J0000000000000000000000B",
            status: "available",
            tokens: null,
            type: "agent.message.delta",
          },
          {
            content: " second",
            durationMs: 0,
            id: "01J00000000000000000000012",
            occurredAt: "2026-05-19T00:00:02.000Z",
            runId: RUN_ID,
            status: "available",
            tokens: null,
            type: "agent.message.delta",
          },
        ],
        { runId: RUN_ID },
      ),
    ).toEqual({ text: "first second" });
  });

  test("throws structured public API errors", async () => {
    const fetchMock: typeof fetch = async () =>
      jsonResponse(
        {
          error: {
            code: "rate_limited",
            message: "Too many requests.",
          },
        },
        429,
      );
    const client = new MosooPublicThreadClient({
      baseUrl: "https://api.example.com/api/v1",
      fetch: fetchMock,
      token: "mst_test",
    });

    await expect(client.listEvents({ threadId: THREAD_ID })).rejects.toMatchObject({
      code: "rate_limited",
      message: "Too many requests.",
      status: 429,
    } satisfies Partial<MosooPublicApiError>);
  });

  test("streams thread.event SSE payloads", async () => {
    const encoder = new TextEncoder();
    const fetchMock: typeof fetch = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `: connected\n\nevent: thread.event\nid: 01J00000000000000000000010\ndata: {"content":"streamed","durationMs":0,"id":"01J00000000000000000000010","occurredAt":"2026-05-19T00:00:00.000Z","runId":"${RUN_ID}","status":"available","tokens":null,"type":"agent.message.delta"}\n\n`,
              ),
            );
            controller.close();
          },
        }),
        {
          headers: { "Content-Type": "text/event-stream" },
          status: 200,
        },
      );
    const client = new MosooPublicThreadClient({
      baseUrl: "https://api.example.com",
      fetch: fetchMock,
      token: "mst_test",
    });
    const events: PublicThreadEventLogEntry[] = [];

    for await (const event of client.streamEvents({ threadId: THREAD_ID })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        content: "streamed",
        durationMs: 0,
        id: "01J00000000000000000000010",
        occurredAt: "2026-05-19T00:00:00.000Z",
        runId: RUN_ID,
        status: "available",
        tokens: null,
        type: "agent.message.delta",
      },
    ]);
  });
});
