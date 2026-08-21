import { PUBLIC_API_VERSION_PREFIX } from "@mosoo/contracts/public-api";
import type { AgentId, PublicThreadId } from "@mosoo/id";
import { Hono } from "hono";
import type { Context } from "hono";

import type { PublicApiCaller } from "../../../modules/auth/application/public-api-caller.service";
import { parseBoundAgentCallBody } from "../../../modules/public-api/app-agent-bound-call";
import { renderBoundAgentCallError } from "../../../modules/public-api/app-agent-bound-errors";
import { publicInvalidRequest } from "../../../modules/public-api/public-api-errors";
import {
  hashPublicApiIdempotencyBody,
  readPublicApiIdempotencyKey,
} from "../../../modules/public-api/public-api-idempotency.service";
import { listAgentApiEndpointThreads } from "../../../modules/public-api/public-thread-session-query.service";
import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";
import { createPublicApiOpenApiDocument } from "./public-api-openapi";
import {
  deploymentCapabilityIdempotencyRoute,
  requireDeploymentCapabilityCaller,
  runPublicApiAuthenticatedJson,
  runPublicApiAuthenticatedResponse,
  runPublicApiSessionMutation,
  runPublicApiThreadMutation,
  runPublicApiThreadReadJson,
  runPublicApiThreadReadResponse,
} from "./public-api-route-support";
import type { PublicApiCallerOptions } from "./public-api-route-support";
import {
  parseFileContentDisposition,
  parseOptionalBoolean,
  parseAgentIdParam,
  parseFileIdParam,
  parseThreadIdParam,
  parseThreadEventsLimit,
  readBoundAgentCallRequestBody,
  readCreateThreadRequest,
  readSendEventsRequest,
} from "./public-thread-api-request";
import type { ParsedCreateThreadRequest } from "./public-thread-api-request";

type PublicApiRouteContext = Context<ApiGatewayEnvironment>;
interface PublicAgentFileUploadRequest {
  file: File;
}
type PublicThreadFileService = Awaited<ReturnType<typeof loadPublicThreadFileService>>;

/**
 * The injected capability URL path within `/api/v1`; the full public prefix is
 * `APP_AGENT_BOUND_PATH_PREFIX` in `app-agent-capability.ts`.
 */
const BOUND_CAPABILITY_ROUTE_BASE = "/bound/:token";

/**
 * One Public Thread surface, two ways to address it. Access Token routes take
 * the Agent from the path and the caller from the bearer header; bound
 * capability routes mount the same operations under the injected capability
 * URL, take the Agent from the verified claims, and resolve the deployment-
 * scoped caller from the token in the path.
 */
interface PublicThreadRouteScope {
  /** Path prefix for Agent-addressed operations (create thread, upload file, list threads). */
  agentBase: string;
  /** Resolves the target Agent after the caller is admitted (path param or capability claim). */
  agentId: (c: PublicApiRouteContext) => (caller: PublicApiCaller) => AgentId;
  /** Path prefix for Thread- and file-addressed operations. */
  base: string;
  options: (c: PublicApiRouteContext) => PublicApiCallerOptions;
}

function deploymentCapabilityAgentId(caller: PublicApiCaller): AgentId {
  if (caller.kind !== "deployment_capability") {
    throw new Error("Bound capability routes require a deployment capability caller.");
  }

  return caller.capability.agentId;
}

const ACCESS_TOKEN_SCOPE: PublicThreadRouteScope = {
  agentBase: "/agents/:agentId",
  agentId: (c) => () => parseAgentIdParam(c.req.param("agentId") ?? ""),
  base: "",
  options: () => ({}),
};

const BOUND_CAPABILITY_SCOPE: PublicThreadRouteScope = {
  agentBase: BOUND_CAPABILITY_ROUTE_BASE,
  agentId: () => deploymentCapabilityAgentId,
  base: BOUND_CAPABILITY_ROUTE_BASE,
  options: (c) => ({
    idempotencyRoute: deploymentCapabilityIdempotencyRoute(c),
    resolveCaller: requireDeploymentCapabilityCaller,
  }),
};

async function loadPublicThreadCommandService() {
  return import("../../../modules/public-api/public-thread-api-command.service");
}

async function loadPublicThreadService() {
  return import("../../../modules/public-api/public-thread-api.service");
}

async function loadPublicThreadFileService() {
  return import("../../../modules/public-api/public-thread-file-api.service");
}

async function loadBoundAgentAskService() {
  return import("../../../modules/public-api/app-agent-bound-ask.service");
}

async function runPublicThreadFileRoute<T>(
  c: PublicApiRouteContext,
  scope: PublicThreadRouteScope,
  operation: (input: {
    caller: PublicApiCaller;
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
    scope.options(c),
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

/**
 * Thread lifecycle, observation, and file routes shared by both scopes. The
 * destructive owner operations (archive, unarchive, delete) stay Access Token
 * only — see `registerAccessTokenOnlyRoutes`.
 */
function registerPublicThreadRoutes(
  v1: Hono<ApiGatewayEnvironment>,
  scope: PublicThreadRouteScope,
): void {
  v1.post(`${scope.agentBase}/threads`, async (c) => {
    return runPublicApiThreadMutation(c, {
      ...scope.options(c),
      agentId: scope.agentId(c),
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

  v1.post(`${scope.agentBase}/files`, async (c) =>
    runPublicApiThreadMutation(c, {
      ...scope.options(c),
      agentId: scope.agentId(c),
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

  v1.get(`${scope.agentBase}/threads`, async (c) =>
    runPublicApiAuthenticatedJson(
      c,
      async (caller) =>
        listAgentApiEndpointThreads(c.env.DB, caller, {
          agentId: scope.agentId(c)(caller),
          archived: parseOptionalBoolean(c.req.query("archived")),
        }),
      200,
      scope.options(c),
    ),
  );

  v1.get(`${scope.base}/threads/:threadId`, async (c) =>
    runPublicApiThreadReadJson(c, {
      ...scope.options(c),
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

  v1.get(`${scope.base}/threads/:threadId/events`, async (c) =>
    runPublicApiThreadReadJson(c, {
      ...scope.options(c),
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

  v1.get(`${scope.base}/threads/:threadId/events/stream`, async (c) =>
    runPublicApiThreadReadResponse(c, {
      ...scope.options(c),
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

  v1.post(`${scope.base}/threads/:threadId/events`, async (c) => {
    return runPublicApiSessionMutation(c, {
      ...scope.options(c),
      bodyHash: (prepared) => prepared.bodyHash,
      operation: async ({ caller, prepared, threadId }) => {
        const { sendPublicThreadSessionEvents } = await loadPublicThreadCommandService();
        return sendPublicThreadSessionEvents({
          bindings: c.env,
          caller,
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

  v1.get(`${scope.base}/threads/:threadId/files`, async (c) =>
    runPublicThreadFileRoute(c, scope, async ({ caller, service, threadId }) =>
      service.listPublicThreadFiles(c.env, caller, threadId),
    ),
  );

  v1.get(`${scope.base}/files/:fileId/content`, async (c) =>
    runPublicApiAuthenticatedResponse(
      c,
      async (caller) => {
        const service = await loadPublicThreadFileService();
        return service.downloadPublicThreadFileContent(c.env, caller, {
          disposition: parseFileContentDisposition(c.req.query("disposition")),
          fileId: parseFileIdParam(c.req.param("fileId")),
        });
      },
      scope.options(c),
    ),
  );

  v1.get(`${scope.base}/files/:fileId`, async (c) =>
    runPublicApiAuthenticatedJson(
      c,
      async (caller) => {
        const service = await loadPublicThreadFileService();
        return service.retrievePublicFile(c.env, caller, parseFileIdParam(c.req.param("fileId")));
      },
      200,
      scope.options(c),
    ),
  );
}

function registerAccessTokenOnlyRoutes(v1: Hono<ApiGatewayEnvironment>): void {
  v1.delete("/files/:fileId", async (c) =>
    runPublicApiAuthenticatedJson(c, async (caller) => {
      const service = await loadPublicThreadFileService();
      await service.deletePublicFile(c.env, caller, parseFileIdParam(c.req.param("fileId")));
      return { ok: true };
    }),
  );

  v1.post("/threads/:threadId/archive", async (c) => {
    return runPublicApiSessionMutation(c, {
      operation: async ({ caller, threadId }) => {
        const { archivePublicThreadSession } = await loadPublicThreadCommandService();
        await archivePublicThreadSession({
          bindings: c.env,
          caller,
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
          caller,
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
          caller,
          threadId,
        });
        return { ok: true };
      },
      threadId: () => parseThreadIdParam(c.req.param("threadId")),
    });
  });

  v1.delete("/threads/:threadId/files/:fileId", async (c) =>
    runPublicThreadFileRoute(c, ACCESS_TOKEN_SCOPE, async ({ caller, service, threadId }) => {
      await service.deletePublicThreadFile(c.env, caller, {
        fileId: parseFileIdParam(c.req.param("fileId")),
        threadId,
      });
      return { ok: true };
    }),
  );
}

export function registerPublicApiRoute(app: Hono<ApiGatewayEnvironment>) {
  const v1 = new Hono<ApiGatewayEnvironment>();

  v1.get("/openapi.json", (c) => c.json(createPublicApiOpenApiDocument(new URL(c.req.url).origin)));

  // The blocking bound-agent ask: POST the injected capability URL itself.
  v1.post(BOUND_CAPABILITY_ROUTE_BASE, async (c) => {
    try {
      const body = await readBoundAgentCallRequestBody(c);
      const { createBoundAgentThreadAndWait } = await loadBoundAgentAskService();
      const result = await createBoundAgentThreadAndWait({
        bindings: c.env,
        executionContext: c.executionCtx,
        idempotencyKey: readPublicApiIdempotencyKey(c.req.raw),
        input: parseBoundAgentCallBody(body),
        requestUrl: c.req.url,
        token: c.req.param("token") ?? "",
      });

      return Response.json(result, { status: 200 });
    } catch (error) {
      const rendered = renderBoundAgentCallError(error);
      return Response.json(rendered.body, { status: rendered.status });
    }
  });

  // The Public Thread and file workflow, addressed by the same capability URL:
  // upload attachments, create and continue Threads, observe Runs, and download
  // artifacts — all scoped to the App, Agent binding, and Deployment that
  // minted the capability, without any owner Access Token.
  registerPublicThreadRoutes(v1, BOUND_CAPABILITY_SCOPE);

  registerPublicThreadRoutes(v1, ACCESS_TOKEN_SCOPE);
  registerAccessTokenOnlyRoutes(v1);

  app.route(PUBLIC_API_VERSION_PREFIX, v1);
}
