import { PUBLIC_THREAD_FILE_UPLOAD_MAX_BYTES } from "@mosoo/contracts/public-api";
import type { PublicApiVersion, PublicThreadConfiguration } from "@mosoo/contracts/public-api";
import type { PlatformId } from "@mosoo/id";
import { Hono } from "hono";
import type { Context } from "hono";

import { FileControlError } from "../../../modules/files/application/file-store";
import { publicInvalidRequest } from "../../../modules/public-api/public-api-errors";
import { hashPublicApiIdempotencyBody } from "../../../modules/public-api/public-api-idempotency.service";
import { listAgentApiEndpointThreads } from "../../../modules/public-api/public-thread-session-query.service";
import type {
  CreatePublicThreadInput,
  CreatePublicThreadRequest,
  PublicThreadCreationSource,
} from "../../../modules/public-api/public-thread.types";
import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";
import { createPublicApiOpenApiDocument } from "./public-api-openapi";
import {
  requirePublicApiCaller,
  requireRateLimitedPublicApiViewer,
  toErrorResponse,
  withPublicApiIdempotency,
} from "./public-api-route-support";
import {
  parseFileContentDisposition,
  parseOptionalBoolean,
  parseAgentIdParam,
  parseProjectIdParam,
  parseFileIdParam,
  parseThreadIdParam,
  parseThreadEventsLimit,
  parseUsageCursor,
  readCreateThreadRequest,
  readCreateProjectThreadRequest,
  readSendEventsRequest,
} from "./public-thread-api-request";

type PublicApiRouteContext = Context<ApiGatewayEnvironment>;

async function loadPublicThreadCommandService() {
  return import("../../../modules/public-api/public-thread-api-command.service");
}

async function loadPublicThreadEventsService() {
  return import("../../../modules/public-api/public-thread-events");
}

async function loadPublicThreadFileService() {
  return import("../../../modules/public-api/public-thread-file-api.service");
}

async function hashCreateThreadIdempotencyBody(
  body: CreatePublicThreadInput,
  configuration?: PublicThreadConfiguration,
): Promise<string | null> {
  return hashPublicApiIdempotencyBody({
    fileIds: body.fileIds,
    inputText: body.inputText ?? null,
    userId: body.userId,
    ...(configuration === undefined ? {} : { configuration }),
  });
}

async function createPublicThreadResponse(
  c: PublicApiRouteContext,
  request: Omit<CreatePublicThreadRequest, "idempotencyCreatedAt" | "idempotencyKey">,
  idempotency: { bodyHash: string | null; subject: PlatformId },
): Promise<Response> {
  const { createPublicThread, recoverPublicThreadCreation } =
    await import("../../../modules/public-api/public-thread-create");

  return withPublicApiIdempotency(c, {
    ...idempotency,
    operation: (idempotencyKey) => createPublicThread({ ...request, idempotencyKey }),
    recover: (idempotencyKey, idempotencyCreatedAt) =>
      recoverPublicThreadCreation({ ...request, idempotencyKey, idempotencyCreatedAt }),
    status: 201,
  });
}

async function readPublicFileUpload(c: PublicApiRouteContext): Promise<File> {
  const file = (await c.req.raw.formData()).get("file");

  if (!(file instanceof File)) {
    throw publicInvalidRequest("multipart/form-data field `file` is required.");
  }

  if (file.size > PUBLIC_THREAD_FILE_UPLOAD_MAX_BYTES) {
    throw new FileControlError(
      400,
      "file_invalid_request",
      `file.size must be ${PUBLIC_THREAD_FILE_UPLOAD_MAX_BYTES} bytes or fewer.`,
    );
  }

  return file;
}

function registerPublicThreadRoutes(
  routes: Hono<ApiGatewayEnvironment>,
  apiVersion: PublicApiVersion,
): void {
  if (apiVersion === "v2") {
    routes.post("/projects/:projectId/threads", async (c) => {
      const caller = await requirePublicApiCaller(c);
      const projectId = parseProjectIdParam(c.req.param("projectId"));
      const { admitPublicProjectCaller } =
        await import("../../../modules/public-api/public-thread-admission");
      await admitPublicProjectCaller(c.env.DB, caller.viewer, projectId);
      const body = await readCreateProjectThreadRequest(c);
      const { configuration } = body;
      const source: PublicThreadCreationSource =
        configuration.type === "agent"
          ? { type: "agent", agentId: configuration.agent_id }
          : {
              type: "inline",
              projectId,
              runtimeId: configuration.harness,
              provider: configuration.provider,
              model: configuration.model,
              instructions: configuration.instructions,
            };

      return createPublicThreadResponse(
        c,
        {
          apiVersion,
          source,
          bindings: c.env,
          caller: { ...caller, viewer: { ...caller.viewer, projectId } },
          executionContext: c.executionCtx,
          input: body,
          requestUrl: c.req.url,
        },
        {
          bodyHash: await hashCreateThreadIdempotencyBody(body, configuration),
          subject: projectId,
        },
      );
    });
    routes.post("/projects/:projectId/files", async (c) => {
      const caller = await requireRateLimitedPublicApiViewer(c);
      const service = await loadPublicThreadFileService();
      const file = await readPublicFileUpload(c);
      return Response.json(
        await service.createPublicProjectFile(c.env, caller, {
          projectId: parseProjectIdParam(c.req.param("projectId")),
          file,
        }),
        { status: 201 },
      );
    });
    routes.get("/threads/:threadId/usage", async (c) => {
      const caller = await requireRateLimitedPublicApiViewer(c);
      const threadId = parseThreadIdParam(c.req.param("threadId"));
      const { listPublicThreadUsage } =
        await import("../../../modules/public-api/public-thread-usage.service");
      return Response.json(
        await listPublicThreadUsage({
          database: c.env.DB,
          caller,
          threadId,
          after: parseUsageCursor(c.req.query("after")),
          limit: parseThreadEventsLimit(c.req.query("limit")),
        }),
      );
    });
  }

  routes.post("/agents/:agentId/threads", async (c) => {
    const caller = await requirePublicApiCaller(c);
    const agentId = parseAgentIdParam(c.req.param("agentId"));
    const body = await readCreateThreadRequest(c, apiVersion);

    return createPublicThreadResponse(
      c,
      {
        apiVersion,
        source: { type: "agent", agentId },
        bindings: c.env,
        caller,
        executionContext: c.executionCtx,
        input: body,
        requestUrl: c.req.url,
      },
      {
        bodyHash: await hashCreateThreadIdempotencyBody(body),
        subject: caller.viewer.projectId ?? caller.tokenId,
      },
    );
  });

  routes.post("/agents/:agentId/files", async (c) => {
    const caller = await requireRateLimitedPublicApiViewer(c);
    const service = await loadPublicThreadFileService();
    const file = await readPublicFileUpload(c);
    return Response.json(
      await service.createPublicAgentFile(
        c.env,
        caller,
        { agentId: parseAgentIdParam(c.req.param("agentId")), file },
        apiVersion,
      ),
      { status: 201 },
    );
  });

  routes.get("/agents/:agentId/threads", async (c) => {
    const caller = await requireRateLimitedPublicApiViewer(c);
    return Response.json(
      await listAgentApiEndpointThreads(c.env.DB, caller, {
        apiVersion,
        agentId: parseAgentIdParam(c.req.param("agentId")),
        archived: parseOptionalBoolean(c.req.query("archived")),
      }),
    );
  });

  routes.get("/threads/:threadId", async (c) => {
    const caller = await requireRateLimitedPublicApiViewer(c);
    const threadId = parseThreadIdParam(c.req.param("threadId"));
    const { retrievePublicThread } =
      await import("../../../modules/public-api/public-thread-retrieve");
    return Response.json(
      await retrievePublicThread({ apiVersion, caller, database: c.env.DB, threadId }),
    );
  });

  routes.get("/threads/:threadId/events", async (c) => {
    const caller = await requireRateLimitedPublicApiViewer(c);
    const threadId = parseThreadIdParam(c.req.param("threadId"));
    const { listPublicThreadEvents } = await loadPublicThreadEventsService();
    return Response.json(
      await listPublicThreadEvents({
        apiVersion,
        caller,
        database: c.env.DB,
        limit: parseThreadEventsLimit(c.req.query("limit")),
        threadId,
      }),
    );
  });

  routes.get("/threads/:threadId/events/stream", async (c) => {
    const caller = await requireRateLimitedPublicApiViewer(c);
    const threadId = parseThreadIdParam(c.req.param("threadId"));
    const { createPublicThreadEventStream } = await loadPublicThreadEventsService();
    const stream = await createPublicThreadEventStream({
      apiVersion,
      bindings: c.env,
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
  });

  routes.post("/threads/:threadId/events", async (c) => {
    const caller = await requirePublicApiCaller(c);
    const threadId = parseThreadIdParam(c.req.param("threadId"));
    const body = await readSendEventsRequest(c);

    return withPublicApiIdempotency(c, {
      bodyHash: await hashPublicApiIdempotencyBody(body),
      operation: async () => {
        const { sendPublicThreadSessionEvents } = await loadPublicThreadCommandService();
        return sendPublicThreadSessionEvents({
          apiVersion,
          bindings: c.env,
          caller: caller.viewer,
          executionContext: c.executionCtx,
          input: body,
          requestUrl: c.req.url,
          threadId,
        });
      },
      status: 200,
      subject: caller.viewer.projectId ?? caller.tokenId,
    });
  });

  routes.get("/threads/:threadId/files", async (c) => {
    const caller = await requireRateLimitedPublicApiViewer(c);
    const threadId = parseThreadIdParam(c.req.param("threadId"));
    const service = await loadPublicThreadFileService();
    return Response.json(await service.listPublicThreadFiles(c.env, caller, threadId, apiVersion));
  });

  routes.get("/files/:fileId/content", async (c) => {
    const caller = await requireRateLimitedPublicApiViewer(c);
    const service = await loadPublicThreadFileService();
    return service.downloadPublicThreadFileContent(
      c.env,
      caller,
      {
        disposition: parseFileContentDisposition(c.req.query("disposition")),
        fileId: parseFileIdParam(c.req.param("fileId")),
      },
      apiVersion,
    );
  });

  routes.get("/files/:fileId", async (c) => {
    const caller = await requireRateLimitedPublicApiViewer(c);
    const service = await loadPublicThreadFileService();
    return Response.json(
      await service.retrievePublicFile(
        c.env,
        caller,
        parseFileIdParam(c.req.param("fileId")),
        apiVersion,
      ),
    );
  });

  routes.delete("/files/:fileId", async (c) => {
    const caller = await requireRateLimitedPublicApiViewer(c);
    const service = await loadPublicThreadFileService();
    await service.deletePublicFile(
      c.env,
      caller,
      parseFileIdParam(c.req.param("fileId")),
      apiVersion,
    );
    return Response.json({ ok: true });
  });

  routes.post("/threads/:threadId/archive", async (c) => {
    const caller = await requireRateLimitedPublicApiViewer(c);
    const threadId = parseThreadIdParam(c.req.param("threadId"));
    const { archivePublicThreadSession } = await loadPublicThreadCommandService();
    await archivePublicThreadSession({ apiVersion, bindings: c.env, caller, threadId });
    return Response.json({ ok: true });
  });

  routes.post("/threads/:threadId/unarchive", async (c) => {
    const caller = await requireRateLimitedPublicApiViewer(c);
    const threadId = parseThreadIdParam(c.req.param("threadId"));
    const { unarchivePublicThreadSession } = await loadPublicThreadCommandService();
    await unarchivePublicThreadSession({ apiVersion, caller, database: c.env.DB, threadId });
    return Response.json({ ok: true });
  });

  routes.delete("/threads/:threadId", async (c) => {
    const caller = await requireRateLimitedPublicApiViewer(c);
    const threadId = parseThreadIdParam(c.req.param("threadId"));
    const { deletePublicThreadSession } = await loadPublicThreadCommandService();
    await deletePublicThreadSession({ apiVersion, bindings: c.env, caller, threadId });
    return Response.json({ ok: true });
  });

  routes.delete("/threads/:threadId/files/:fileId", async (c) => {
    const caller = await requireRateLimitedPublicApiViewer(c);
    const threadId = parseThreadIdParam(c.req.param("threadId"));
    const service = await loadPublicThreadFileService();
    await service.deletePublicThreadFile(
      c.env,
      caller,
      { fileId: parseFileIdParam(c.req.param("fileId")), threadId },
      apiVersion,
    );
    return Response.json({ ok: true });
  });
}

export function registerPublicApiRoute(app: Hono<ApiGatewayEnvironment>) {
  for (const apiVersion of ["v1", "v2"] as const) {
    const routes = new Hono<ApiGatewayEnvironment>();
    routes.get("/openapi.json", (c) =>
      c.json(createPublicApiOpenApiDocument(new URL(c.req.url).origin, apiVersion)),
    );
    registerPublicThreadRoutes(routes, apiVersion);
    // Hono snapshots a sub-app's error handler when it is mounted.
    routes.onError((error) => toErrorResponse(error));
    app.route(`/${apiVersion}`, routes);
  }
}
