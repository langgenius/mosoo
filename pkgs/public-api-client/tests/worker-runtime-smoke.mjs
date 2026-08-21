import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { webcrypto } from "node:crypto";
import { createServer } from "node:http";

import { unstable_startWorker } from "wrangler";

const THREAD_ID = "01J00000000000000000000009";
const RUN_ID = "01J0000000000000000000000A";
const FILE_ID = "01J0000000000000000000000J";
const API_TOKEN = "worker-test-token";
const encoder = new TextEncoder();

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function bodyBuffer(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function handleApiRequest(request, response) {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.headers.authorization !== `Bearer ${API_TOKEN}`) {
    json(response, 401, { error: { code: "unauthenticated" } });
    return;
  }

  if (request.method === "POST" && url.pathname.endsWith("/agents/agent-1/files")) {
    const body = await bodyBuffer(request);
    const contentType = request.headers["content-type"] ?? "";

    if (
      !contentType.startsWith("multipart/form-data;") ||
      !body.includes('filename="worker.txt"') ||
      !body.includes("Worker upload.")
    ) {
      json(response, 400, { error: { code: "invalid_request" } });
      return;
    }

    json(response, 201, {
      file: {
        createdAt: "2026-08-11T00:00:00.000Z",
        id: FILE_ID,
        mimeType: "text/plain",
        name: "worker.txt",
        size: 14,
      },
    });
    return;
  }

  if (request.method === "POST" && url.pathname.endsWith("/agents/agent-1/threads")) {
    if (request.headers["idempotency-key"] !== "worker-operation-1") {
      json(response, 400, { error: { code: "invalid_request" } });
      return;
    }

    json(response, 201, {
      links: { thread: `/api/v1/threads/${THREAD_ID}` },
      run: {
        completedAt: null,
        createdAt: "2026-08-11T00:00:00.000Z",
        error: null,
        finalOutput: null,
        id: RUN_ID,
        startedAt: "2026-08-11T00:00:01.000Z",
        status: "running",
        trigger: "user_prompt",
        updatedAt: "2026-08-11T00:00:01.000Z",
      },
      thread: thread("RUNNING", "2026-08-11T00:00:01.000Z"),
    });
    return;
  }

  if (request.method === "GET" && url.pathname.endsWith(`/threads/${THREAD_ID}`)) {
    json(response, 200, {
      links: { thread: `/api/v1/threads/${THREAD_ID}` },
      run: {
        completedAt: "2026-08-11T00:00:02.000Z",
        createdAt: "2026-08-11T00:00:00.000Z",
        error: null,
        finalOutput: { text: "Worker complete." },
        id: RUN_ID,
        startedAt: "2026-08-11T00:00:01.000Z",
        status: "completed",
        trigger: "user_prompt",
        updatedAt: "2026-08-11T00:00:02.000Z",
      },
      thread: thread("IDLE", "2026-08-11T00:00:02.000Z"),
    });
    return;
  }

  if (request.method === "GET" && url.pathname.endsWith(`/threads/${THREAD_ID}/events/stream`)) {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(
      `event: thread.event\nid: event-1\ndata: {"content":"Worker progress.","durationMs":0,"id":"event-1","occurredAt":"2026-08-11T00:00:01.000Z","runId":"${RUN_ID}","status":"available","tokens":null,"type":"agent.message.delta"}\n\n`,
    );
    return;
  }

  json(response, 404, { error: { code: "not_found" } });
}

function thread(status, updatedAt) {
  return {
    agent_id: "agent-1",
    created_at: "2026-08-11T00:00:00.000Z",
    id: THREAD_ID,
    kind: "pet",
    last_run_id: RUN_ID,
    source: "api",
    status,
    title: "Worker smoke",
    updated_at: updatedAt,
    userId: "worker-user",
  };
}

async function createDelegationToken(audience) {
  const issuedAt = Math.floor(Date.now() / 1_000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      act: { agent_id: "agent-1", app_id: "app-1" },
      aud: audience,
      exp: issuedAt + 60,
      iat: issuedAt,
      iss: "mosoo",
      jti: "00000000-0000-4000-8000-000000000001",
      run_id: RUN_ID,
      sub: "worker-user",
      thread_id: THREAD_ID,
    }),
  ).toString("base64url");
  const material = await webcrypto.subtle.digest(
    "SHA-256",
    encoder.encode(`mosoo-mcp-delegation-v1\0${API_TOKEN}`),
  );
  const key = await webcrypto.subtle.importKey(
    "raw",
    material,
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await webcrypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${header}.${payload}`),
  );

  return `${header}.${payload}.${Buffer.from(signature).toString("base64url")}`;
}

function withTimeout(promise, message) {
  let timeout;
  const expired = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), 15_000);
  });

  return Promise.race([promise, expired]).finally(() => clearTimeout(timeout));
}

const config = process.argv[2];

if (config === undefined) {
  throw new Error("Worker config path is required.");
}

const apiServer = createServer((request, response) => {
  handleApiRequest(request, response).catch((error) => {
    json(response, 500, { error: error instanceof Error ? error.message : "Unknown mock error." });
  });
});
await new Promise((resolve, reject) => {
  apiServer.once("error", reject);
  apiServer.listen(0, "127.0.0.1", resolve);
});
const address = apiServer.address();

if (address === null || typeof address === "string") {
  throw new Error("Mock API did not bind a TCP port.");
}

let worker;

try {
  worker = await withTimeout(unstable_startWorker({ config }), "Worker did not start in 15s.");
  const delegationAudience = "https://tools.example.com/mcp";
  const response = await withTimeout(
    worker.fetch("http://example.com", {
      body: JSON.stringify({
        apiBaseUrl: `http://127.0.0.1:${address.port}`,
        apiToken: API_TOKEN,
        delegationAudience,
        delegationToken: await createDelegationToken(delegationAudience),
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
    "Worker SDK flow did not finish in 15s.",
  );
  const result = await response.json();

  assert.equal(response.status, 200, JSON.stringify(result));
  assert.deepEqual(result, {
    aborted: true,
    delegationUserId: "worker-user",
    eventContent: "Worker progress.",
    fileName: "worker.txt",
    finalText: "Worker complete.",
    runId: RUN_ID,
    threadId: THREAD_ID,
  });
} finally {
  await worker?.dispose();
  await new Promise((resolve, reject) => {
    apiServer.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
