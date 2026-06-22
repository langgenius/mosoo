import type { CompleteFileUploadRequest } from "@mosoo/contracts/file";
import { PUBLIC_API_VERSION_PREFIX } from "@mosoo/contracts/public-api";
import type { PublicThreadId } from "@mosoo/id";
import { Hono } from "hono";
import type { Context } from "hono";

import type { PersonalAccessTokenCaller } from "../../../modules/auth/application/personal-access-token.service";
import { hashPublicApiIdempotencyBody } from "../../../modules/public-api/public-api-idempotency.service";
import { listAgentApiEndpointThreads } from "../../../modules/public-api/public-thread-session-query.service";
import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";
import { createPublicApiOpenApiDocument } from "./public-api-openapi";
import {
  runPublicApiAuthenticatedJson,
  runPublicApiSessionMutation,
  runPublicApiThreadMutation,
  runPublicApiThreadReadJson,
  runPublicApiThreadReadResponse,
} from "./public-api-route-support";
import {
  parseOptionalBoolean,
  parseAgentIdParam,
  parseFileIdParam,
  parseThreadIdParam,
  parseThreadEventsLimit,
  readCreateThreadRequest,
  readCreateThreadFileRequest,
  readCreateThreadFileUploadRequest,
  readSendEventsRequest,
} from "./public-thread-api-request";
import type { ParsedCreateThreadRequest } from "./public-thread-api-request";

type PublicApiRouteContext = Context<ApiGatewayEnvironment>;
type PublicThreadFileService = Awaited<ReturnType<typeof loadPublicThreadFileService>>;

async function loadPublicThreadCommandService() {
  return import("../../../modules/public-api/public-thread-api-command.service");
}

async function loadPublicThreadService() {
  return import("../../../modules/public-api/public-thread-api.service");
}

async function loadPublicThreadFileService() {
  return import("../../../modules/public-api/public-thread-file-api.service");
}

async function runPublicThreadFileRoute<T>(
  c: PublicApiRouteContext,
  operation: (input: {
    caller: PersonalAccessTokenCaller;
    service: PublicThreadFileService;
    threadId: PublicThreadId;
  }) => Promise<T>,
  status = 200,
): Promise<Response> {
  return runPublicApiAuthenticatedJson(
    c,
    async (caller) =>
      operation({
        caller,
        service: await loadPublicThreadFileService(),
        threadId: parseThreadIdParam(c.req.param("threadId") ?? ""),
      }),
    status,
  );
}

async function hashCreateThreadIdempotencyBody(
  body: ParsedCreateThreadRequest,
): Promise<string | null> {
  return hashPublicApiIdempotencyBody({
    clientExternalRef: body.clientExternalRef ?? null,
    fileIds: body.fileIds,
    inputText: body.inputText ?? null,
  });
}

export function registerPublicApiRoute(app: Hono<ApiGatewayEnvironment>) {
  const v1 = new Hono<ApiGatewayEnvironment>();

  v1.get("/openapi.json", (c) => c.json(createPublicApiOpenApiDocument(new URL(c.req.url).origin)));

  v1.post("/agents/:agentId/threads", async (c) => {
    return runPublicApiThreadMutation(c, {
      agentId: () => parseAgentIdParam(c.req.param("agentId")),
      bodyHash: (prepared) => prepared.bodyHash,
      operation: async ({ agentId, caller, prepared }) => {
        const { createPublicThread } = await loadPublicThreadService();
        return createPublicThread({
          agentId,
          bindings: c.env,
          caller,
          executionContext: c.executionCtx,
          input: prepared.body,
          requestUrl: c.req.url,
        });
      },
      prepare: async () => {
        const body = await readCreateThreadRequest(c);
        return {
          body,
          bodyHash: await hashCreateThreadIdempotencyBody(body),
        };
      },
      status: 201,
    });
  });

  v1.get("/threads/:threadId", async (c) =>
    runPublicApiThreadReadJson(c, {
      operation: async ({ caller, threadId }) => {
        const { retrievePublicThread } = await loadPublicThreadService();
        return retrievePublicThread({
          caller,
          database: c.env.DB,
          threadId,
        });
      },
      threadId: () => parseThreadIdParam(c.req.param("threadId")),
    }),
  );

  v1.get("/threads/:threadId/events", async (c) =>
    runPublicApiThreadReadJson(c, {
      operation: async ({ caller, threadId }) => {
        const { listPublicThreadEvents } = await loadPublicThreadService();
        return listPublicThreadEvents({
          caller,
          database: c.env.DB,
          limit: parseThreadEventsLimit(c.req.query("limit")),
          threadId,
        });
      },
      threadId: () => parseThreadIdParam(c.req.param("threadId")),
    }),
  );

  v1.get("/threads/:threadId/events/stream", async (c) =>
    runPublicApiThreadReadResponse(c, {
      operation: async ({ caller, threadId }) => {
        const { createPublicThreadEventStream } = await loadPublicThreadService();
        const stream = await createPublicThreadEventStream({
          caller,
          database: c.env.DB,
          limit: parseThreadEventsLimit(c.req.query("limit")),
          signal: c.req.raw.signal,
          threadId,
        });

        return new Response(stream, {
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "text/event-stream; charset=utf-8",
            "X-Accel-Buffering": "no",
          },
        });
      },
      threadId: () => parseThreadIdParam(c.req.param("threadId")),
    }),
  );

  v1.get("/agents/:agentId/threads", async (c) =>
    runPublicApiAuthenticatedJson(c, async (caller) =>
      listAgentApiEndpointThreads(c.env.DB, caller.viewer, {
        agentId: parseAgentIdParam(c.req.param("agentId")),
        archived: parseOptionalBoolean(c.req.query("archived")),
      }),
    ),
  );

  v1.put("/files/:fileId/content", async (c) =>
    runPublicApiAuthenticatedJson(c, async (caller) => {
      const service = await loadPublicThreadFileService();
      await service.putPublicThreadFileContent(c.env, caller.viewer, {
        body: c.req.raw.body,
        fileId: parseFileIdParam(c.req.param("fileId")),
      });
      return { ok: true };
    }),
  );

  v1.post("/files/:fileId/complete", async (c) =>
    runPublicApiAuthenticatedJson(c, async (caller) => {
      const service = await loadPublicThreadFileService();
      return service.completePublicThreadFileUpload(c.env, caller.viewer, {
        fileId: parseFileIdParam(c.req.param("fileId")),
        request: await c.req.json<CompleteFileUploadRequest>(),
      });
    }),
  );

  v1.post("/threads/:threadId/events", async (c) => {
    return runPublicApiSessionMutation(c, {
      bodyHash: (prepared) => prepared.bodyHash,
      operation: async ({ caller, prepared, threadId }) => {
        const { sendPublicThreadSessionEvents } = await loadPublicThreadCommandService();
        return sendPublicThreadSessionEvents({
          bindings: c.env,
          caller: caller.viewer,
          executionContext: c.executionCtx,
          input: prepared.body,
          requestUrl: c.req.url,
          threadId,
        });
      },
      prepare: async () => {
        const body = await readSendEventsRequest(c);
        return {
          body,
          bodyHash: await hashPublicApiIdempotencyBody(body),
        };
      },
      threadId: () => parseThreadIdParam(c.req.param("threadId")),
    });
  });

  v1.post("/threads/:threadId/archive", async (c) => {
    return runPublicApiSessionMutation(c, {
      operation: async ({ caller, threadId }) => {
        const { archivePublicThreadSession } = await loadPublicThreadCommandService();
        await archivePublicThreadSession({
          bindings: c.env,
          caller: caller.viewer,
          threadId,
        });
        return { ok: true };
      },
      threadId: () => parseThreadIdParam(c.req.param("threadId")),
    });
  });

  v1.post("/threads/:threadId/unarchive", async (c) => {
    return runPublicApiSessionMutation(c, {
      operation: async ({ caller, threadId }) => {
        const { unarchivePublicThreadSession } = await loadPublicThreadCommandService();
        await unarchivePublicThreadSession({
          caller: caller.viewer,
          database: c.env.DB,
          threadId,
        });
        return { ok: true };
      },
      threadId: () => parseThreadIdParam(c.req.param("threadId")),
    });
  });

  v1.delete("/threads/:threadId", async (c) => {
    return runPublicApiSessionMutation(c, {
      operation: async ({ caller, threadId }) => {
        const { deletePublicThreadSession } = await loadPublicThreadCommandService();
        await deletePublicThreadSession({
          bindings: c.env,
          caller: caller.viewer,
          threadId,
        });
        return { ok: true };
      },
      threadId: () => parseThreadIdParam(c.req.param("threadId")),
    });
  });

  v1.get("/threads/:threadId/files", async (c) =>
    runPublicThreadFileRoute(c, async ({ caller, service, threadId }) =>
      service.listPublicThreadFiles(c.env, caller.viewer, threadId),
    ),
  );

  v1.post("/threads/:threadId/files", async (c) =>
    runPublicThreadFileRoute(
      c,
      async ({ caller, service, threadId }) =>
        service.createPublicThreadFile(
          c.env,
          caller.viewer,
          threadId,
          await readCreateThreadFileRequest(c),
        ),
      201,
    ),
  );

  v1.post("/threads/:threadId/files/uploads", async (c) =>
    runPublicThreadFileRoute(
      c,
      async ({ caller, service, threadId }) =>
        service.createPublicThreadFileUpload(
          c.env,
          caller.viewer,
          threadId,
          await readCreateThreadFileUploadRequest(c),
        ),
      201,
    ),
  );

  v1.delete("/threads/:threadId/files/:fileId", async (c) =>
    runPublicThreadFileRoute(c, async ({ caller, service, threadId }) => {
      await service.deletePublicThreadFile(c.env, caller.viewer, {
        fileId: parseFileIdParam(c.req.param("fileId")),
        threadId,
      });
      return { ok: true };
    }),
  );

  app.route(PUBLIC_API_VERSION_PREFIX, v1);
}
