import { describe, expect, test } from "bun:test";

import type {
  MosooPublicApiError,
  MosooPublicApiFetch,
  MosooPublicThreadRunMismatchError,
} from "../src/index.ts";
import {
  extractFinalOutput,
  MosooPublicApiAbortError,
  MosooPublicApiTimeoutError,
  MosooPublicThreadClient,
  MosooPublicThreadTerminalRunError,
} from "../src/index.ts";
import type {
  PublicThreadApiCreateThreadResponse,
  PublicThreadApiRetrieveThreadResponse,
  PublicThreadEventLogEntry,
  PublicThreadArtifact,
  PublicThreadFinalOutput,
} from "../src/types.ts";

interface RecordedRequest {
  body: unknown;
  headers: Headers;
  method: string;
  url: string;
}

const THREAD_ID = "01J00000000000000000000009";
const RUN_ID = "01J0000000000000000000000A";
const FILE_ID = "01J0000000000000000000000J";
const ARTIFACT = {
  createdAt: "2026-05-19T00:00:01.500Z",
  fileId: FILE_ID,
  kind: "artifact",
  mimeType: "text/html",
  name: "index.html",
  runId: RUN_ID,
  size: 42,
} satisfies PublicThreadArtifact;

function threadResponse(status: "RUNNING" | "IDLE" = "RUNNING") {
  return {
    agent_id: "01J00000000000000000000001",
    created_at: "2026-05-19T00:00:00.000Z",
    id: THREAD_ID,
    kind: "pet",
    last_run_id: RUN_ID,
    source: "api",
    status,
    title: "Say hello",
    updated_at: "2026-05-19T00:00:01.000Z",
    userId: "customer-123",
  } as const;
}

function runResponse(
  status: "cancelled" | "completed" | "expired" | "failed" | "running" = "running",
  finalOutput: PublicThreadFinalOutput | null = null,
) {
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
  } as const;
}

async function readRequestBody(request: Request): Promise<unknown> {
  const text = await request.text();

  return text.length === 0 ? null : JSON.parse(text);
}

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected promise to reject.");
}

describe("MosooPublicThreadClient", () => {
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
          run: {
            ...runResponse("completed", { text: "最终答复：完整的中文、Markdown 和 😀。" }),
            artifacts: [ARTIFACT],
          },
          thread: threadResponse("IDLE"),
        } satisfies PublicThreadApiRetrieveThreadResponse);
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
    expect(result.run.artifacts).toEqual([ARTIFACT]);
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

  test("does not read progress events to reconstruct a completed final output", async () => {
    const requests: string[] = [];
    const fetchMock: MosooPublicApiFetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request.url);

      if (request.method === "GET" && request.url.endsWith(`/threads/${THREAD_ID}`)) {
        return jsonResponse({
          links: { thread: `/api/v1/threads/${THREAD_ID}` },
          run: runResponse("completed"),
          thread: threadResponse("IDLE"),
        } satisfies PublicThreadApiRetrieveThreadResponse);
      }

      return jsonResponse({ error: { code: "not_found", message: "Not found." } }, 404);
    };
    const client = new MosooPublicThreadClient({
      baseUrl: "https://api.example.com",
      fetch: fetchMock,
      token: "mst_test",
    });

    expect(
      await captureRejection(client.waitForFinalOutput({ threadId: THREAD_ID })),
    ).toMatchObject({
      message: `Completed Public Thread run ${RUN_ID} did not include final output.`,
    });
    expect(requests).toEqual([`https://api.example.com/api/v1/threads/${THREAD_ID}`]);
  });

  test("resumes a Run from persisted ids in a new client instance", async () => {
    const fetchMock: MosooPublicApiFetch = async () =>
      jsonResponse({
        links: { thread: `/api/v1/threads/${THREAD_ID}` },
        run: runResponse("completed", { text: "Recovered." }),
        thread: threadResponse("IDLE"),
      } satisfies PublicThreadApiRetrieveThreadResponse);

    const result = await new MosooPublicThreadClient({
      baseUrl: "https://api.example.com",
      fetch: fetchMock,
      token: "mst_test",
    }).waitForFinalOutput({ runId: RUN_ID, threadId: THREAD_ID });

    expect(result.finalOutput.text).toBe("Recovered.");
  });

  test("distinguishes timeout, abort, and Run mismatch", async () => {
    const runningFetch: MosooPublicApiFetch = async () =>
      jsonResponse({
        links: { thread: `/api/v1/threads/${THREAD_ID}` },
        run: runResponse("running"),
        thread: threadResponse(),
      } satisfies PublicThreadApiRetrieveThreadResponse);
    const client = new MosooPublicThreadClient({
      baseUrl: "https://api.example.com",
      fetch: runningFetch,
      pollIntervalMs: 1,
      token: "mst_test",
    });

    expect(
      await captureRejection(client.waitForRun({ threadId: THREAD_ID, timeoutMs: 1 })),
    ).toBeInstanceOf(MosooPublicApiTimeoutError);

    const stalledClient = new MosooPublicThreadClient({
      baseUrl: "https://api.example.com",
      fetch: async () => new Promise<Response>(() => {}),
      token: "mst_test",
    });
    expect(
      await captureRejection(stalledClient.waitForRun({ threadId: THREAD_ID, timeoutMs: 1 })),
    ).toBeInstanceOf(MosooPublicApiTimeoutError);

    const controller = new AbortController();
    controller.abort();
    expect(
      await captureRejection(client.waitForRun({ signal: controller.signal, threadId: THREAD_ID })),
    ).toBeInstanceOf(MosooPublicApiAbortError);

    expect(
      await captureRejection(client.waitForRun({ runId: "another-run", threadId: THREAD_ID })),
    ).toMatchObject({
      actualRunId: RUN_ID,
      code: "run_mismatch",
      expectedRunId: "another-run",
    } satisfies Partial<MosooPublicThreadRunMismatchError>);
  });

  test("rejects unsafe client configuration before sending a token", () => {
    expect(() => new MosooPublicThreadClient({ token: " " })).toThrow(
      "Mosoo token must not be empty.",
    );
    expect(
      () => new MosooPublicThreadClient({ baseUrl: "http://api.example.com", token: "mst_test" }),
    ).toThrow("Mosoo baseUrl must use HTTPS");
    expect(
      () =>
        new MosooPublicThreadClient({
          baseUrl: "https://user:secret@api.example.com?token=leak",
          token: "mst_test",
        }),
    ).toThrow("must not include credentials");
    expect(
      () =>
        new MosooPublicThreadClient({
          baseUrl: "http://localhost:8787",
          token: "mst_test",
        }),
    ).not.toThrow();
  });

  test("rejects browser-like runtimes by default", () => {
    const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "document", { configurable: true, value: {} });
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });

    try {
      expect(() => new MosooPublicThreadClient({ token: "mst_test" })).toThrow(
        "must run on a backend, Worker, or Node-like runtime",
      );
      expect(
        () => new MosooPublicThreadClient({ allowBrowserToken: true, token: "mst_test" }),
      ).not.toThrow();
    } finally {
      if (documentDescriptor === undefined) {
        Reflect.deleteProperty(globalThis, "document");
      } else {
        Object.defineProperty(globalThis, "document", documentDescriptor);
      }

      if (windowDescriptor === undefined) {
        Reflect.deleteProperty(globalThis, "window");
      } else {
        Object.defineProperty(globalThis, "window", windowDescriptor);
      }
    }
  });

  test("keeps the deprecated event concatenation helper for compatibility", () => {
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

    expect(await captureRejection(client.listEvents({ threadId: THREAD_ID }))).toMatchObject({
      code: "rate_limited",
      message: "Too many requests.",
      status: 429,
    } satisfies Partial<MosooPublicApiError>);
  });

  test("lists typed Thread files", async () => {
    const fetchMock: MosooPublicApiFetch = async (input, init) => {
      const request = new Request(input, init);

      expect(request.method).toBe("GET");
      expect(request.url).toBe(`https://api.example.com/api/v1/threads/${THREAD_ID}/files`);

      return jsonResponse({
        files: [
          {
            committed: true,
            createdAt: ARTIFACT.createdAt,
            fileId: FILE_ID,
            id: FILE_ID,
            kind: "artifact",
            mimeType: ARTIFACT.mimeType,
            name: ARTIFACT.name,
            runId: RUN_ID,
            size: ARTIFACT.size,
          },
        ],
      });
    };
    const client = new MosooPublicThreadClient({
      baseUrl: "https://api.example.com",
      fetch: fetchMock,
      token: "mst_test",
    });

    const result = await client.listFiles({ threadId: THREAD_ID });

    expect(result.files[0]).toMatchObject({ fileId: FILE_ID, runId: RUN_ID });
  });

  test("streams thread.event SSE payloads", async () => {
    const encoder = new TextEncoder();
    let cancelled = false;
    const fetchMock: MosooPublicApiFetch = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            cancelled = true;
          },
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `: connected\n\nevent: thread.event\nid: 01J00000000000000000000010\ndata: {"artifact":${JSON.stringify(ARTIFACT)},"content":"Session files updated.","durationMs":0,"id":"01J00000000000000000000010","occurredAt":"2026-05-19T00:00:00.000Z","runId":"${RUN_ID}","status":"available","tokens":null,"type":"session_files.updated"}\n\n`,
              ),
            );
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
      break;
    }

    expect(cancelled).toBe(true);
    expect(events).toEqual([
      {
        artifact: ARTIFACT,
        content: "Session files updated.",
        durationMs: 0,
        id: "01J00000000000000000000010",
        occurredAt: "2026-05-19T00:00:00.000Z",
        runId: RUN_ID,
        status: "available",
        tokens: null,
        type: "session_files.updated",
      },
    ]);
  });
});
