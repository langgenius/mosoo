import type {
  PublicApiVersion,
  PublicThreadApiCreateThreadResponse,
  PublicThreadConfiguration,
} from "@mosoo/contracts/public-api";
import type { ProjectId, PublicThreadId } from "@mosoo/id";
import { Hono } from "hono";
import type { Context } from "hono";

import type { PersonalAccessTokenCaller } from "../../../modules/auth/application/personal-access-token.service";
import type { AuthenticatedViewer } from "../../../modules/auth/application/viewer-auth.service";
import { publicInvalidRequest } from "../../../modules/public-api/public-api-errors";
import { hashPublicApiIdempotencyBody } from "../../../modules/public-api/public-api-idempotency.service";
import { listAgentApiEndpointThreads } from "../../../modules/public-api/public-thread-session-query.service";
import type { PublicThreadCreationSource } from "../../../modules/public-api/public-thread.types";
import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";
import { createPublicApiOpenApiDocument } from "./public-api-openapi";
import {
  runPublicApiAuthenticatedJson,
  runPublicApiAuthenticatedResponse,
  runPublicApiSessionMutation,
  runPublicApiThreadMutation,
  runPublicApiThreadReadJson,
  runPublicApiThreadReadResponse,
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
import type {
  ParsedCreateProjectThreadRequest,
  ParsedCreateThreadRequest,
} from "./public-thread-api-request";

type PublicApiRouteContext = Context<ApiGatewayEnvironment>;
interface PublicAgentFileUploadRequest {
  file: File;
}
type PublicThreadFileService = Awaited<ReturnType<typeof loadPublicThreadFileService>>;

interface PreparedProjectThreadCreation {
  projectId: ProjectId;
  source: PublicThreadCreationSource;
  body: ParsedCreateProjectThreadRequest;
  caller: PersonalAccessTokenCaller;
  bodyHash: string | null;
}

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
    caller: AuthenticatedViewer;
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
  configuration?: PublicThreadConfiguration,
): Promise<string | null> {
  return hashPublicApiIdempotencyBody({
    fileIds: body.fileIds,
    inputText: body.inputText ?? null,
    ...(body.maxCostUsd === undefined ? {} : { maxCostUsd: body.maxCostUsd }),
    userId: body.userId,
    ...(configuration === undefined ? {} : { configuration }),
  });
}

async function readPublicAgentFileUploadRequest(
  c: PublicApiRouteContext,
): Promise<PublicAgentFileUploadRequest> {
  const formData = await c.req.raw.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    throw publicInvalidRequest("multipart/form-data field `file` is required.");
  }

  return { file };
}

function registerPublicThreadRoutes(
  routes: Hono<ApiGatewayEnvironment>,
  apiVersion: PublicApiVersion,
): void {
  if (apiVersion === "v2") {
    routes.post("/projects/:projectId/threads", async (c) =>
      runPublicApiThreadMutation<
        PublicThreadApiCreateThreadResponse<string | null>,
        PreparedProjectThreadCreation
      >(c, {
        bodyHash: (prepared) => prepared.bodyHash,
        idempotencySubjectId: (prepared) => prepared.projectId,
        prepare: async ({ caller }): Promise<PreparedProjectThreadCreation> => {
          const projectId = parseProjectIdParam(c.req.param("projectId") ?? "");
          const { admitPublicProjectCaller } =
            await import("../../../modules/public-api/public-thread-admission");
          await admitPublicProjectCaller(c.env.DB, caller.viewer, projectId);
          const body = await readCreateProjectThreadRequest(c);
          const configuration = body.configuration;
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
          return {
            projectId,
            source,
            body,
            caller: { ...caller, viewer: { ...caller.viewer, projectId } },
            bodyHash: await hashCreateThreadIdempotencyBody(body, configuration),
          };
        },
        operation: async ({ idempotencyKey, prepared }) => {
          const { createPublicThread } = await loadPublicThreadService();
          return createPublicThread({
            apiVersion: "v2",
            source: prepared.source,
            caller: prepared.caller,
            bindings: c.env,
            executionContext: c.executionCtx,
            idempotencyKey,
            input: prepared.body,
            requestUrl: c.req.url,
          });
        },
        recover: async ({ idempotencyKey, idempotencyCreatedAt, prepared }) => {
          const { recoverPublicThreadCreation } = await loadPublicThreadService();
          return recoverPublicThreadCreation({
            apiVersion: "v2",
            source: prepared.source,
            caller: prepared.caller,
            bindings: c.env,
            executionContext: c.executionCtx,
            idempotencyKey,
            idempotencyCreatedAt,
            input: prepared.body,
            requestUrl: c.req.url,
          });
        },
        status: 201,
      }),
    );
    routes.post("/projects/:projectId/files", async (c) =>
      runPublicApiAuthenticatedJson(
        c,
        async (caller) => {
          const service = await loadPublicThreadFileService();
          const prepared = await readPublicAgentFileUploadRequest(c);
          return service.createPublicProjectFile(c.env, caller, {
            projectId: parseProjectIdParam(c.req.param("projectId") ?? ""),
            file: prepared.file,
          });
        },
        201,
      ),
    );
    routes.get("/threads/:threadId/usage", async (c) =>
      runPublicApiThreadReadJson(c, {
        operation: async ({ caller, threadId }) => {
          const { listPublicThreadUsage } =
            await import("../../../modules/public-api/public-thread-usage.service");
          return listPublicThreadUsage({
            database: c.env.DB,
            caller,
            threadId,
            after: parseUsageCursor(c.req.query("after")),
            limit: parseThreadEventsLimit(c.req.query("limit")),
          });
        },
        threadId: () => parseThreadIdParam(c.req.param("threadId")),
      }),
    );
  }
  routes.post("/agents/:agentId/threads", async (c) => {
    return runPublicApiThreadMutation(c, {
      bodyHash: (prepared) => prepared.bodyHash,
      operation: async ({ caller, idempotencyKey, prepared }) => {
        const { createPublicThread } = await loadPublicThreadService();
        return createPublicThread({
          apiVersion,
          source: { type: "agent", agentId: prepared.agentId },
          bindings: c.env,
          caller,
          executionContext: c.executionCtx,
          idempotencyKey,
          input: prepared.body,
          requestUrl: c.req.url,
        });
      },
      prepare: async () => {
        const agentId = parseAgentIdParam(c.req.param("agentId") ?? "");
        const body = await readCreateThreadRequest(c, apiVersion);
        return {
          agentId,
          body,
          bodyHash: await hashCreateThreadIdempotencyBody(body),
        };
      },
      recover: async ({ caller, idempotencyKey, idempotencyCreatedAt, prepared }) => {
        const { recoverPublicThreadCreation } = await loadPublicThreadService();
        return recoverPublicThreadCreation({
          apiVersion,
          source: { type: "agent", agentId: prepared.agentId },
          bindings: c.env,
          caller,
          executionContext: c.executionCtx,
          idempotencyKey,
          idempotencyCreatedAt,
          input: prepared.body,
          requestUrl: c.req.url,
        });
      },
      status: 201,
    });
  });

  routes.post("/agents/:agentId/files", async (c) =>
    runPublicApiAuthenticatedJson(
      c,
      async (caller) => {
        const service = await loadPublicThreadFileService();
        const prepared = await readPublicAgentFileUploadRequest(c);
        return service.createPublicAgentFile(
          c.env,
          caller,
          {
            agentId: parseAgentIdParam(c.req.param("agentId") ?? ""),
            file: prepared.file,
          },
          apiVersion,
        );
      },
      201,
    ),
  );

  routes.get("/agents/:agentId/threads", async (c) =>
    runPublicApiAuthenticatedJson(c, async (caller) =>
      listAgentApiEndpointThreads(c.env.DB, caller, {
        apiVersion,
        agentId: parseAgentIdParam(c.req.param("agentId") ?? ""),
        archived: parseOptionalBoolean(c.req.query("archived")),
      }),
    ),
  );

  routes.get("/threads/:threadId", async (c) =>
    runPublicApiThreadReadJson(c, {
      operation: async ({ caller, threadId }) => {
        const { retrievePublicThread } = await loadPublicThreadService();
        return retrievePublicThread({
          apiVersion,
          caller,
          database: c.env.DB,
          threadId,
        });
      },
      threadId: () => parseThreadIdParam(c.req.param("threadId")),
    }),
  );

  routes.get("/threads/:threadId/events", async (c) =>
    runPublicApiThreadReadJson(c, {
      operation: async ({ caller, threadId }) => {
        const { listPublicThreadEvents } = await loadPublicThreadService();
        return listPublicThreadEvents({
          apiVersion,
          caller,
          database: c.env.DB,
          limit: parseThreadEventsLimit(c.req.query("limit")),
          threadId,
        });
      },
      threadId: () => parseThreadIdParam(c.req.param("threadId")),
    }),
  );

  routes.get("/threads/:threadId/events/stream", async (c) =>
    runPublicApiThreadReadResponse(c, {
      operation: async ({ caller, threadId }) => {
        const { createPublicThreadEventStream } = await loadPublicThreadService();
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
      },
      threadId: () => parseThreadIdParam(c.req.param("threadId")),
    }),
  );

  routes.post("/threads/:threadId/events", async (c) => {
    return runPublicApiSessionMutation(c, {
      bodyHash: (prepared) => prepared.bodyHash,
      operation: async ({ caller, prepared, threadId }) => {
        const { sendPublicThreadSessionEvents } = await loadPublicThreadCommandService();
        return sendPublicThreadSessionEvents({
          apiVersion,
          bindings: c.env,
          caller,
          executionContext: c.executionCtx,
          input: prepared.body,
          requestUrl: c.req.url,
          threadId,
        });
      },
      prepare: async () => {
        const body = await readSendEventsRequest(c, apiVersion);
        return {
          body,
          bodyHash: await hashPublicApiIdempotencyBody(body),
        };
      },
      threadId: () => parseThreadIdParam(c.req.param("threadId")),
    });
  });

  routes.get("/threads/:threadId/files", async (c) =>
    runPublicThreadFileRoute(c, async ({ caller, service, threadId }) =>
      service.listPublicThreadFiles(c.env, caller, threadId, apiVersion),
    ),
  );

  routes.get("/files/:fileId/content", async (c) =>
    runPublicApiAuthenticatedResponse(c, async (caller) => {
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
    }),
  );

  routes.get("/files/:fileId", async (c) =>
    runPublicApiAuthenticatedJson(c, async (caller) => {
      const service = await loadPublicThreadFileService();
      return service.retrievePublicFile(
        c.env,
        caller,
        parseFileIdParam(c.req.param("fileId")),
        apiVersion,
      );
    }),
  );

  routes.delete("/files/:fileId", async (c) =>
    runPublicApiAuthenticatedJson(c, async (caller) => {
      const service = await loadPublicThreadFileService();
      await service.deletePublicFile(
        c.env,
        caller,
        parseFileIdParam(c.req.param("fileId")),
        apiVersion,
      );
      return { ok: true };
    }),
  );

  routes.post("/threads/:threadId/archive", async (c) => {
    return runPublicApiSessionMutation(c, {
      operation: async ({ caller, threadId }) => {
        const { archivePublicThreadSession } = await loadPublicThreadCommandService();
        await archivePublicThreadSession({
          apiVersion,
          bindings: c.env,
          caller,
          threadId,
        });
        return { ok: true };
      },
      threadId: () => parseThreadIdParam(c.req.param("threadId")),
    });
  });

  routes.post("/threads/:threadId/unarchive", async (c) => {
    return runPublicApiSessionMutation(c, {
      operation: async ({ caller, threadId }) => {
        const { unarchivePublicThreadSession } = await loadPublicThreadCommandService();
        await unarchivePublicThreadSession({
          apiVersion,
          caller,
          database: c.env.DB,
          threadId,
        });
        return { ok: true };
      },
      threadId: () => parseThreadIdParam(c.req.param("threadId")),
    });
  });

  routes.delete("/threads/:threadId", async (c) => {
    return runPublicApiSessionMutation(c, {
      operation: async ({ caller, threadId }) => {
        const { deletePublicThreadSession } = await loadPublicThreadCommandService();
        await deletePublicThreadSession({
          apiVersion,
          bindings: c.env,
          caller,
          threadId,
        });
        return { ok: true };
      },
      threadId: () => parseThreadIdParam(c.req.param("threadId")),
    });
  });

  routes.delete("/threads/:threadId/files/:fileId", async (c) =>
    runPublicThreadFileRoute(c, async ({ caller, service, threadId }) => {
      await service.deletePublicThreadFile(
        c.env,
        caller,
        {
          fileId: parseFileIdParam(c.req.param("fileId")),
          threadId,
        },
        apiVersion,
      );
      return { ok: true };
    }),
  );
}

export function registerPublicApiRoute(app: Hono<ApiGatewayEnvironment>) {
  for (const apiVersion of ["v1", "v2"] as const) {
    const routes = new Hono<ApiGatewayEnvironment>();
    routes.get("/openapi.json", (c) =>
      c.json(createPublicApiOpenApiDocument(new URL(c.req.url).origin, apiVersion)),
    );
    registerPublicThreadRoutes(routes, apiVersion);
    app.route(`/${apiVersion}`, routes);
  }
}
