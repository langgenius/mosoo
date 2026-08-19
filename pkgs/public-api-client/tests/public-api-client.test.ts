import { describe, expect, test } from "bun:test";

import type {
  PublicFileResponse,
  PublicThreadApiCreateThreadResponse,
  PublicThreadApiListThreadEventsResponse,
  PublicThreadApiRetrieveThreadResponse,
  PublicThreadEventLogEntry,
  PublicThreadFinalOutput,
  PublicThreadRunSummary,
  PublicThreadSummary,
} from "@mosoo/contracts/public-api";
import type { MosooPublicApiError, MosooPublicApiFetch } from "@mosoo/public-api-client";
import { MosooClient, MosooPublicThreadClient } from "@mosoo/public-api-client";
import { MosooPublicThreadTerminalRunError } from "@mosoo/public-api-client";
import { extractFinalOutput } from "@mosoo/public-api-client";

interface RecordedRequest {
  body: unknown;
  headers: Headers;
  method: string;
  url: string;
}

const AGENT_ID = "01J00000000000000000000001" as PublicThreadSummary["agent_id"];
const THREAD_ID = "01J00000000000000000000009" as PublicThreadSummary["id"];
const RUN_ID = "01J0000000000000000000000A" as NonNullable<PublicThreadSummary["last_run_id"]>;
const ALT_RUN_ID = "01J0000000000000000000000B" as NonNullable<PublicThreadSummary["last_run_id"]>;
const FILE_ID = "01J0000000000000000000000J" as PublicFileResponse["file"]["id"];
const EVENT_ID_10 = "01J00000000000000000000010" as PublicThreadEventLogEntry["id"];
const EVENT_ID_11 = "01J00000000000000000000011" as PublicThreadEventLogEntry["id"];
const EVENT_ID_12 = "01J00000000000000000000012" as PublicThreadEventLogEntry["id"];

function threadResponse(status: "RUNNING" | "IDLE" = "RUNNING"): PublicThreadSummary {
  return {
    agent_id: AGENT_ID,
    created_at: "2026-05-19T00:00:00.000Z",
    id: THREAD_ID,
    kind: "pet",
    last_run_id: RUN_ID,
    source: "api",
    status,
    title: "Say hello",
    updated_at: "2026-05-19T00:00:01.000Z",
    userId: "customer-123",
  };
}

function runResponse(
  status: "completed" | "failed" | "running" = "running",
  finalOutput: PublicThreadFinalOutput | null = null,
): PublicThreadRunSummary {
  return {
    completedAt: status === "running" ? null : "2026-05-19T00:00:02.000Z",
    createdAt: "2026-05-19T00:00:00.000Z",
    error:
      status === "failed"
        ? {
            code: "provider_unavailable",
            message: "Provider is temporarily unavailable.",
            retryable: true,
          }
        : null,
    finalOutput,
    id: RUN_ID,
    startedAt: "2026-05-19T00:00:01.000Z",
    status,
    trigger: "user_prompt",
    updatedAt: "2026-05-19T00:00:02.000Z",
  };
}

async function readRequestBody(request: Request): Promise<unknown> {
  const text = await request.text();

  return text.length === 0 ? null : JSON.parse(text);
}

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

describe("MosooPublicThreadClient", () => {
  test("starts a Harness Run with a Workspace API key", async () => {
    const requests: RecordedRequest[] = [];
    const fetchMock: MosooPublicApiFetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push({
        body: await readRequestBody(request.clone()),
        headers: request.headers,
        method: request.method,
        url: request.url,
      });
      return jsonResponse(
        {
          environment: {
            id: "01J00000000000000000000007",
            name: "Default",
            revisionId: "01J00000000000000000000008",
          },
          id: RUN_ID,
          links: {
            approve: `/api/v1/runs/${RUN_ID}/approve`,
            artifacts: `/api/v1/runs/${RUN_ID}/artifacts`,
            cancel: `/api/v1/runs/${RUN_ID}/cancel`,
            events: `/api/v1/runs/${RUN_ID}/events`,
            result: `/api/v1/runs/${RUN_ID}/result`,
            stream: `/api/v1/runs/${RUN_ID}/events/stream`,
          },
          model: "gpt-5.5",
          source: {
            harness: "openai-codex",
            kind: "harness",
            profile: {
              id: "openai-codex/mosoo-baseline",
              revision: "4e834acc7ef873b4dc884ecea42c7651f808e0c0",
              version: "2026.08-experiment.2",
            },
            version: "2026.08-experiment.2",
          },
          status: "queued",
          threadId: THREAD_ID,
          workspaceId: "01J0000000000000000000000Q",
        },
        201,
      );
    };
    const mosoo = new MosooClient({
      baseUrl: "https://api.example.com",
      fetch: fetchMock,
      token: "msk_workspace_test",
    });

    const run = await mosoo.run({
      harness: "openai-codex",
      input: "Review this repository",
      profile: "openai-codex/mosoo-baseline@2026.08-experiment.2",
    });

    expect(run).toMatchObject({
      id: RUN_ID,
      source: { harness: "openai-codex", kind: "harness" },
    });
    expect(requests[0]).toMatchObject({
      body: {
        harness: "openai-codex",
        input: "Review this repository",
        profile: "openai-codex/mosoo-baseline@2026.08-experiment.2",
      },
      method: "POST",
      url: "https://api.example.com/api/v1/runs",
    });
    expect(requests[0]?.headers.get("Authorization")).toBe("Bearer msk_workspace_test");
  });

  test("maps createThread fileIds to public file resources", async () => {
    const requests: RecordedRequest[] = [];
    const fetchMock: MosooPublicApiFetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push({
        body: await readRequestBody(request.clone()),
        headers: request.headers,
        method: request.method,
        url: request.url,
      });

      return jsonResponse(
        {
          links: { thread: `/api/v1/threads/${THREAD_ID}` },
          run: null,
          thread: threadResponse("IDLE"),
        } satisfies PublicThreadApiCreateThreadResponse,
        201,
      );
    };
    const client = new MosooPublicThreadClient({
      baseUrl: "https://api.example.com",
      fetch: fetchMock,
      token: "mst_test",
    });

    await client.createThread({
      agentId: "agent-1",
      fileIds: [FILE_ID],
      input: "Summarize the file.",
      userId: "customer-123",
    });

    expect(requests[0]?.body).toEqual({
      input: {
        content: [{ text: "Summarize the file.", type: "text" }],
        type: "user.message",
      },
      resources: [{ file_id: FILE_ID, type: "file" }],
      userId: "customer-123",
    });
  });

  test("uploads Agent files through multipart/form-data", async () => {
    const fetchMock: MosooPublicApiFetch = async (input, init) => {
      const request = new Request(input, init);
      const formData = await request.formData();
      const file = formData.get("file");

      expect(request.method).toBe("POST");
      expect(request.url).toBe("https://api.example.com/api/v1/agents/agent-1/files");
      expect(request.headers.get("Authorization")).toBe("Bearer mst_test");
      expect(request.headers.get("Content-Type")).toStartWith("multipart/form-data;");
      expect(file).toBeInstanceOf(File);
      expect(file).toMatchObject({
        name: "brief.txt",
        size: 12,
      });

      return jsonResponse(
        {
          file: {
            createdAt: "2026-05-19T00:00:00.000Z",
            id: FILE_ID,
            mimeType: "text/plain",
            name: "brief.txt",
            size: 12,
          },
        },
        201,
      );
    };
    const client = new MosooPublicThreadClient({
      baseUrl: "https://api.example.com",
      fetch: fetchMock,
      token: "mst_test",
    });

    const response = await client.uploadAgentFile({
      agentId: "agent-1",
      file: new Blob([new TextEncoder().encode("Hello file.\n")], { type: "text/plain" }),
      filename: "brief.txt",
    });

    expect(response.file.id).toBe(FILE_ID);
  });

  test("creates a Thread and returns the canonical final output from retrieve", async () => {
    const requests: RecordedRequest[] = [];
    const fetchMock: MosooPublicApiFetch = async (input, init) => {
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
          run: runResponse("completed", { text: "最终答复：完整的中文、Markdown 和 😀。" }),
          thread: threadResponse("IDLE"),
        } satisfies PublicThreadApiRetrieveThreadResponse);
      }

      if (request.method === "GET" && request.url.includes(`/threads/${THREAD_ID}/events`)) {
        return jsonResponse({
          events: [
            {
              content: "Old output",
              durationMs: 0,
              id: EVENT_ID_10,
              occurredAt: "2026-05-19T00:00:00.000Z",
              runId: ALT_RUN_ID,
              status: "available",
              tokens: null,
              type: "agent.message.delta",
            },
            {
              content: "进度：正在生成最终答复。",
              durationMs: 0,
              id: EVENT_ID_11,
              occurredAt: "2026-05-19T00:00:01.000Z",
              runId: RUN_ID,
              status: "available",
              tokens: null,
              type: "agent.message.delta",
            },
            {
              content: "不应被拼入最终答复。",
              durationMs: 0,
              id: EVENT_ID_12,
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
      userId: "customer-123",
    });

    expect(result.finalOutput).toEqual({ text: "最终答复：完整的中文、Markdown 和 😀。" });
    expect(result.run.finalOutput).toEqual({ text: "最终答复：完整的中文、Markdown 和 😀。" });
    expect(requests[0]?.headers.get("Authorization")).toBe("Bearer mst_test");
    expect(requests[0]?.headers.get("Idempotency-Key")).toBe("thread-create-1");
    expect(requests[0]?.body).toEqual({
      input: {
        content: [{ text: "Say hello from the API.", type: "text" }],
        type: "user.message",
      },
      userId: "customer-123",
    });
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/api/v1/agents/agent-1/threads",
      `/api/v1/threads/${THREAD_ID}`,
      `/api/v1/threads/${THREAD_ID}/events`,
    ]);
  });

  test("throws a structured error when createThreadAndWait reaches a failed run", async () => {
    const fetchMock: MosooPublicApiFetch = async (input, init) => {
      const request = new Request(input, init);

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
          run: runResponse("failed"),
          thread: threadResponse("IDLE"),
        } satisfies PublicThreadApiRetrieveThreadResponse);
      }

      if (request.method === "GET" && request.url.includes(`/threads/${THREAD_ID}/events`)) {
        return jsonResponse({
          events: [],
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
    let thrown: unknown = null;

    try {
      await client.createThreadAndWait({
        agentId: "agent-1",
        input: "Fail loudly.",
        timeoutMs: 1_000,
        userId: "customer-123",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MosooPublicThreadTerminalRunError);
    expect(thrown).toMatchObject({
      code: "run_terminal_failure",
      finalOutput: null,
      run: {
        error: {
          code: "provider_unavailable",
          message: "Provider is temporarily unavailable.",
          retryable: true,
        },
        status: "failed",
      },
      runStatus: "failed",
      truncated: false,
    });
  });

  test("can opt out of failed terminal run throwing", async () => {
    const fetchMock: MosooPublicApiFetch = async (input, init) => {
      const request = new Request(input, init);

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
          run: runResponse("failed"),
          thread: threadResponse("IDLE"),
        } satisfies PublicThreadApiRetrieveThreadResponse);
      }

      if (request.method === "GET" && request.url.includes(`/threads/${THREAD_ID}/events`)) {
        return jsonResponse({
          events: [],
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
      input: "Return terminal status.",
      throwOnFailedRun: false,
      timeoutMs: 1_000,
      userId: "customer-123",
    });

    expect(result.run.status).toBe("failed");
    expect(result.finalOutput).toBeNull();
    expect(result.run.error).toMatchObject({
      code: "provider_unavailable",
      message: "Provider is temporarily unavailable.",
      retryable: true,
    });
  });

  test("does not reconstruct a completed final output from progress events", async () => {
    const fetchMock: MosooPublicApiFetch = async (input, init) => {
      const request = new Request(input, init);

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
              content: "进度：读取资料。",
              durationMs: 0,
              id: EVENT_ID_10,
              occurredAt: "2026-05-19T00:00:00.000Z",
              runId: RUN_ID,
              status: "available",
              tokens: null,
              type: "agent.message.delta",
            },
            {
              content: "错误的事件拼接候选。",
              durationMs: 0,
              id: EVENT_ID_11,
              occurredAt: "2026-05-19T00:00:01.000Z",
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

    let thrown: unknown = null;

    try {
      await client.waitForFinalOutput({ threadId: THREAD_ID });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(
      `Completed Public Thread run ${RUN_ID} did not include final output.`,
    );
  });

  test("keeps the deprecated event concatenation helper for compatibility", () => {
    expect(
      extractFinalOutput(
        [
          {
            content: "first",
            durationMs: 0,
            id: EVENT_ID_10,
            occurredAt: "2026-05-19T00:00:00.000Z",
            runId: RUN_ID,
            status: "available",
            tokens: null,
            type: "agent.message.delta",
          },
          {
            content: "ignored",
            durationMs: 0,
            id: EVENT_ID_11,
            occurredAt: "2026-05-19T00:00:01.000Z",
            runId: ALT_RUN_ID,
            status: "available",
            tokens: null,
            type: "agent.message.delta",
          },
          {
            content: " second",
            durationMs: 0,
            id: EVENT_ID_12,
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
    const fetchMock: MosooPublicApiFetch = async () =>
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

    let thrown: unknown = null;

    try {
      await client.listEvents({ threadId: THREAD_ID });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: "rate_limited",
      message: "Too many requests.",
      status: 429,
    } satisfies Partial<MosooPublicApiError>);
  });

  test("streams thread.event SSE payloads", async () => {
    const encoder = new TextEncoder();
    const fetchMock: MosooPublicApiFetch = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `: connected\n\nevent: thread.event\nid: 01J00000000000000000000010\ndata: {"content":"record_meal","durationMs":0,"id":"01J00000000000000000000010","occurredAt":"2026-05-19T00:00:00.000Z","runId":"${RUN_ID}","status":"available","toolCallId":"tool-1","toolInput":{"calories":420},"toolName":"record_meal","tokens":null,"type":"tool.use.started"}\n\n`,
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
        content: "record_meal",
        durationMs: 0,
        id: EVENT_ID_10,
        occurredAt: "2026-05-19T00:00:00.000Z",
        runId: RUN_ID,
        status: "available",
        toolCallId: "tool-1",
        toolInput: { calories: 420 },
        toolName: "record_meal",
        tokens: null,
        type: "tool.use.started",
      },
    ]);
  });
});
