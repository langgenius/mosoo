import { expect } from "bun:test";

import { PUBLIC_API_PREFIX } from "@mosoo/contracts/public-api";
import type { SessionRuntimeEventVisibility } from "@mosoo/contracts/session";
import { sessionEventsTable } from "@mosoo/db";
import { createRuntimeEvent } from "@mosoo/runtime-events";
import type { RuntimeEventKind, RuntimeEventVisibility } from "@mosoo/runtime-events";
import { Hono } from "hono";

import { registerPublicApiRoute } from "../src/adapters/http/routes/public-api-route";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { createSessionRuntimeEventProjection } from "../src/modules/sessions/domain/session-runtime-event-projection";
import { runWithRequestLogContext } from "../src/platform/cloudflare/logger";
import {
  PUBLIC_API_TEST_IDS,
  createPublicHttpTestBindings,
  createTestExecutionContext,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/public-api-http-test-fixture";

export const OWNER_VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: PUBLIC_API_TEST_IDS.ownerAccount,
  imageUrl: null,
  name: "Owner",
};

export function bearer(token: string): string {
  return `Bearer ${token}`;
}

export function createPublicThreadApiTestApp(): Hono {
  const app = new Hono();
  const publicApi = new Hono();
  registerPublicApiRoute(publicApi);
  app.route(PUBLIC_API_PREFIX, publicApi);
  return app;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function expectRecord(value: unknown): Record<string, unknown> {
  expect(value).toBeObject();
  if (!isRecord(value)) {
    throw new Error("Expected a JSON object.");
  }

  return value;
}

export function expectString(value: unknown): string {
  expect(value).toBeString();
  if (typeof value !== "string") {
    throw new Error("Expected a string.");
  }

  return value;
}

export function expectArray(value: unknown): unknown[] {
  expect(value).toBeArray();
  if (!Array.isArray(value)) {
    throw new Error("Expected a JSON array.");
  }

  return value;
}

export async function readJson(response: Response): Promise<Record<string, unknown>> {
  return expectRecord(await response.json());
}

export async function requestPublicApi(
  app: Hono,
  database: SqliteD1Database,
  request: Request,
  options: Parameters<typeof createPublicHttpTestBindings>[1] = {},
): Promise<Response> {
  return requestPublicApiWithBindings(
    app,
    request,
    createPublicHttpTestBindings(database, options) as ApiBindings,
  );
}

export async function requestPublicApiWithBindings(
  app: Hono,
  request: Request,
  bindings: ApiBindings,
): Promise<Response> {
  return runWithRequestLogContext(request, () =>
    app.request(request, undefined, bindings, createTestExecutionContext()),
  );
}

export async function withProviderProbeMock<T>(operation: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      data: [{ id: "gpt-5.4" }],
    });

  try {
    return await operation();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const RUNTIME_EVENT_IDS_BY_SEQ = [
  "01J00000000000000000000010",
  "01J00000000000000000000011",
  "01J00000000000000000000012",
  "01J00000000000000000000013",
  "01J00000000000000000000014",
  "01J00000000000000000000015",
  "01J00000000000000000000016",
  "01J00000000000000000000017",
];

function runtimeEventIdForSeq(seq: number): string {
  const id = RUNTIME_EVENT_IDS_BY_SEQ[seq - 1];

  if (!id) {
    throw new Error(`Missing runtime event ID fixture for seq ${seq}.`);
  }

  return id;
}

export async function insertRuntimeEvent(
  database: SqliteD1Database,
  input: {
    kind: RuntimeEventKind;
    occurredAt: number;
    payload: unknown;
    runId?: string | null;
    seq: number;
    sessionId: string;
    visibility?: RuntimeEventVisibility;
  },
): Promise<void> {
  const runId = input.runId ?? null;
  const visibility = input.visibility ?? "participant";
  const databaseVisibility: SessionRuntimeEventVisibility =
    visibility === "public" || visibility === "participant" ? "all_consumers" : "owner_debug";
  const eventId = runtimeEventIdForSeq(input.seq);
  const event = createRuntimeEvent({
    actor: "driver",
    id: eventId,
    kind: input.kind,
    occurredAt: new Date(input.occurredAt).toISOString(),
    origin: "driver",
    payload: input.payload,
    ...(runId === null ? {} : { runId }),
    sessionId: input.sessionId,
    visibility,
  });
  const projection = createSessionRuntimeEventProjection(event);

  await database
    .app()
    .insert(sessionEventsTable)
    .values({
      agentId: PUBLIC_API_TEST_IDS.agent,
      contentText: projection.contentText,
      createdAt: input.occurredAt,
      endedAt: input.occurredAt,
      eventType: input.kind,
      family: projection.family,
      id: eventId,
      occurredAt: input.occurredAt,
      processStatus: projection.processStatus,
      processType: projection.processType,
      runId,
      seq: input.seq,
      sessionId: input.sessionId,
      source: "driver",
      sourceEventId: eventId,
      tokens: projection.tokens,
      traceId: null,
      visibility: databaseVisibility,
    })
    .run();
}

class PublicEventTestSocket extends EventTarget {
  readyState = WebSocket.CONNECTING;

  accept(): void {
    this.readyState = WebSocket.OPEN;
  }

  close(): void {
    if (this.readyState >= WebSocket.CLOSING) {
      return;
    }

    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }

  emit(): void {
    this.dispatchEvent(new MessageEvent("message", { data: "events" }));
  }
}

export function createPublicEventSessionNamespace(): {
  binding: ApiBindings["Session"];
  close: () => void;
  emit: () => void;
} {
  const sockets = new Set<PublicEventTestSocket>();
  const stub = {
    closeViewers: async () => {},
    destroy: async () => {},
    fetch: async () => {
      const socket = new PublicEventTestSocket();
      sockets.add(socket);
      return { status: 101, webSocket: socket as unknown as WebSocket } as Response;
    },
    publishEvents: async () => {
      for (const socket of sockets) {
        socket.emit();
      }
    },
  };

  return {
    binding: {
      get: () => stub,
      idFromName: (name: string) => name,
    } as unknown as ApiBindings["Session"],
    close: () => {
      for (const socket of sockets) {
        socket.close();
      }
    },
    emit: () => {
      void stub.publishEvents();
    },
  };
}
