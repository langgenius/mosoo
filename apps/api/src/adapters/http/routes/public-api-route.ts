import { PUBLIC_API_VERSION_PREFIX } from "@mosoo/contracts/public-api";
import type { PublicThreadId } from "@mosoo/id";
import { getHarnessCatalogEntry, listHarnessCatalog } from "@mosoo/runtime-catalog";
import { Hono } from "hono";
import type { Context } from "hono";

import type { PersonalAccessTokenCaller } from "../../../modules/auth/application/personal-access-token.service";
import { publicInvalidRequest } from "../../../modules/public-api/public-api-errors";
import { hashPublicApiIdempotencyBody } from "../../../modules/public-api/public-api-idempotency.service";
import { listAgentApiEndpointThreads } from "../../../modules/public-api/public-thread-session-query.service";
import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";
import { createPublicApiOpenApiDocument } from "./public-api-openapi";
import {
  runPublicApiAuthenticatedJson,
  runPublicApiAuthenticatedResponse,
  runPublicApiSessionMutation,
  runPublicApiThreadMutation,
  runPublicApiThreadReadJson,
  runPublicApiThreadReadResponse,
  runWorkspaceApiAuthenticatedJson,
  runWorkspaceApiAuthenticatedResponse,
} from "./public-api-route-support";
import {
  parseFileContentDisposition,
  parseOptionalBoolean,
  parseAgentIdParam,
  parseFileIdParam,
  parseThreadIdParam,
  parseThreadEventsLimit,
  parseRunIdParam,
  readCreateThreadRequest,
  readSendEventsRequest,
} from "./public-thread-api-request";
import type { ParsedCreateThreadRequest } from "./public-thread-api-request";
import {
  readCreateWorkspaceRunRequest,
  readWorkspaceRunApprovalRequest,
} from "./workspace-run-api-request";

type PublicApiRouteContext = Context<ApiGatewayEnvironment>;
interface PublicAgentFileUploadRequest {
  file: File;
}
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

async function loadWorkspaceRunService() {
  return import("../../../modules/public-api/workspace-run-api.service");
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
    fileIds: body.fileIds,
    inputText: body.inputText ?? null,
    userId: body.userId,
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

export function registerPublicApiRoute(app: Hono<ApiGatewayEnvironment>) {
  const v1 = new Hono<ApiGatewayEnvironment>();

  v1.get("/openapi.json", (c) => c.json(createPublicApiOpenApiDocument(new URL(c.req.url).origin)));

  v1.get("/harnesses", (c) => c.json({ harnesses: listHarnessCatalog() }));

  v1.get("/harnesses/:slug", (c) => {
    const harness = getHarnessCatalogEntry(c.req.param("slug"));

    return harness === null
      ? c.json({ error: { code: "not_found", message: "Harness was not found." } }, 404)
      : c.json({ harness });
  });

  v1.post("/runs", (c) =>
    runWorkspaceApiAuthenticatedJson(
      c,
      async (caller) => {
        const service = await loadWorkspaceRunService();
        return service.startWorkspaceRun({
          bindings: c.env,
          caller,
          executionContext: c.executionCtx,
          input: await readCreateWorkspaceRunRequest(c),
          requestUrl: c.req.url,
        });
      },
      201,
    ),
  );

  v1.get("/runs/:runId", (c) =>
    runWorkspaceApiAuthenticatedJson(c, async (caller) => {
      const service = await loadWorkspaceRunService();
      return service.retrieveWorkspaceRun(c.env.DB, caller, parseRunIdParam(c.req.param("runId")));
    }),
  );

  v1.get("/runs/:runId/events", (c) =>
    runWorkspaceApiAuthenticatedJson(c, async (caller) => {
      const service = await loadWorkspaceRunService();
      return service.listWorkspaceRunEvents({
        caller,
        database: c.env.DB,
        limit: parseThreadEventsLimit(c.req.query("limit")),
        runId: parseRunIdParam(c.req.param("runId")),
      });
    }),
  );

  v1.get("/runs/:runId/events/stream", (c) =>
    runWorkspaceApiAuthenticatedResponse(c, async (caller) => {
      const service = await loadWorkspaceRunService();
      const stream = await service.streamWorkspaceRunEvents({
        bindings: c.env,
        caller,
        limit: parseThreadEventsLimit(c.req.query("limit")),
        runId: parseRunIdParam(c.req.param("runId")),
        signal: c.req.raw.signal,
      });

      return new Response(stream, {
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "text/event-stream; charset=utf-8",
          "X-Accel-Buffering": "no",
        },
      });
    }),
  );

  v1.get("/runs/:runId/result", (c) =>
    runWorkspaceApiAuthenticatedJson(c, async (caller) => {
      const service = await loadWorkspaceRunService();
      return service.retrieveWorkspaceRunResult({
        caller,
        database: c.env.DB,
        runId: parseRunIdParam(c.req.param("runId")),
      });
    }),
  );

  v1.get("/runs/:runId/artifacts", (c) =>
    runWorkspaceApiAuthenticatedJson(c, async (caller) => {
      const service = await loadWorkspaceRunService();
      return service.listWorkspaceRunArtifacts({
        bindings: c.env,
        caller,
        runId: parseRunIdParam(c.req.param("runId")),
      });
    }),
  );

  v1.post("/runs/:runId/approve", (c) =>
    runWorkspaceApiAuthenticatedJson(c, async (caller) => {
      const service = await loadWorkspaceRunService();
      const approval = await readWorkspaceRunApprovalRequest(c);
      return service.approveWorkspaceRun({
        bindings: c.env,
        caller,
        decision: approval.decision,
        executionContext: c.executionCtx,
        requestId: approval.requestId,
        requestUrl: c.req.url,
        runId: parseRunIdParam(c.req.param("runId")),
      });
    }),
  );

  v1.post("/runs/:runId/cancel", (c) =>
    runWorkspaceApiAuthenticatedJson(c, async (caller) => {
      const service = await loadWorkspaceRunService();
      return service.cancelWorkspaceRun({
        bindings: c.env,
        caller,
        runId: parseRunIdParam(c.req.param("runId")),
      });
    }),
  );

  v1.post("/agents/:agentId/threads", async (c) => {
    return runPublicApiThreadMutation(c, {
      agentId: () => parseAgentIdParam(c.req.param("agentId")),
      bodyHash: (prepared) => prepared.bodyHash,
      operation: async ({ agentId, caller, idempotencyKey, prepared }) => {
        const { createPublicThread } = await loadPublicThreadService();
        return createPublicThread({
          agentId,
          bindings: c.env,
          caller,
          executionContext: c.executionCtx,
          idempotencyKey,
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
      recover: async ({ agentId, caller, idempotencyKey, prepared }) => {
        const { recoverPublicThreadCreation } = await loadPublicThreadService();
        return recoverPublicThreadCreation({
          agentId,
          bindings: c.env,
          caller,
          executionContext: c.executionCtx,
          idempotencyKey,
          input: prepared.body,
          requestUrl: c.req.url,
        });
      },
      status: 201,
    });
  });

  v1.post("/agents/:agentId/files", async (c) =>
    runPublicApiThreadMutation(c, {
      agentId: () => parseAgentIdParam(c.req.param("agentId")),
      operation: async ({ agentId, caller, prepared }) => {
        const service = await loadPublicThreadFileService();
        return service.createPublicAgentFile(c.env, caller, {
          agentId,
          file: prepared.file,
        });
      },
      prepare: async () => readPublicAgentFileUploadRequest(c),
      status: 201,
    }),
  );

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

  v1.get("/agents/:agentId/threads", async (c) =>
    runPublicApiAuthenticatedJson(c, async (caller) =>
      listAgentApiEndpointThreads(c.env.DB, caller.viewer, {
        agentId: parseAgentIdParam(c.req.param("agentId")),
        archived: parseOptionalBoolean(c.req.query("archived")),
      }),
    ),
  );

  v1.get("/files/:fileId/content", async (c) =>
    runPublicApiAuthenticatedResponse(c, async (caller) => {
      const service = await loadPublicThreadFileService();
      return service.downloadPublicThreadFileContent(c.env, caller.viewer, {
        disposition: parseFileContentDisposition(c.req.query("disposition")),
        fileId: parseFileIdParam(c.req.param("fileId")),
      });
    }),
  );

  v1.get("/files/:fileId", async (c) =>
    runPublicApiAuthenticatedJson(c, async (caller) => {
      const service = await loadPublicThreadFileService();
      return service.retrievePublicFile(
        c.env,
        caller.viewer,
        parseFileIdParam(c.req.param("fileId")),
      );
    }),
  );

  v1.delete("/files/:fileId", async (c) =>
    runPublicApiAuthenticatedJson(c, async (caller) => {
      const service = await loadPublicThreadFileService();
      await service.deletePublicFile(c.env, caller.viewer, parseFileIdParam(c.req.param("fileId")));
      return { ok: true };
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
