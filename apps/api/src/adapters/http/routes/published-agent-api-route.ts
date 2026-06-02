import { PUBLISHED_AGENT_API_PREFIX } from "@mosoo/contracts/public-api";
import { Hono } from "hono";

import { AUDIT_ACTION } from "../../../modules/audit/domain/audit-vocabulary";
import { hashPublicApiIdempotencyBody } from "../../../modules/public-api/published-agent-idempotency.service";
import { listPublishedAgentThreads } from "../../../modules/public-api/published-agent-session-query.service";
import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";
import {
  parseOptionalBoolean,
  parseAgentIdParam,
  parseFileIdParam,
  parseThreadIdParam,
  parseThreadEventsLimit,
  readCreateThreadRequest,
  readCreateThreadFileRequest,
  readSendEventsRequest,
} from "./published-agent-api-request";
import type { ParsedCreateThreadRequest } from "./published-agent-api-request";
import {
  runPublishedApiAuthenticatedJson,
  runPublishedApiSessionMutation,
  runPublishedApiThreadMutation,
  runPublishedApiThreadReadJson,
} from "./published-agent-api-route-support";
import { createPublishedAgentOpenApiDocument } from "./published-agent-openapi";

async function loadPublishedAgentCommandService() {
  return import("../../../modules/public-api/published-agent-api.service");
}

async function loadPublishedAgentThreadService() {
  return import("../../../modules/public-api/published-agent-thread-api.service");
}

async function loadPublishedSessionFileService() {
  return import("../../../modules/public-api/published-session-file-api.service");
}

async function hashCreateThreadIdempotencyBody(
  body: ParsedCreateThreadRequest,
): Promise<string | null> {
  return hashPublicApiIdempotencyBody({
    attributedUserId: body.attributedUserId ?? null,
    clientExternalRef: body.clientExternalRef ?? null,
    fileIds: body.fileIds,
    inputText: body.inputText,
  });
}

export function registerPublishedAgentApiRoute(app: Hono<ApiGatewayEnvironment>) {
  const v1 = new Hono<ApiGatewayEnvironment>();

  v1.get("/openapi.json", (c) =>
    c.json(createPublishedAgentOpenApiDocument(new URL(c.req.url).origin)),
  );

  v1.post("/agents/:agentId/threads", async (c) => {
    return runPublishedApiThreadMutation(c, {
      action: AUDIT_ACTION.sessionCreate,
      agentId: () => parseAgentIdParam(c.req.param("agentId")),
      auditContext: (prepared) => ({
        attributedUserId: prepared.body.attributedUserId,
        clientExternalRef: prepared.body.clientExternalRef,
      }),
      bodyHash: (prepared) => prepared.bodyHash,
      operation: async ({ agentId, caller, prepared }) => {
        const { createPublishedAgentThread } = await loadPublishedAgentThreadService();
        return createPublishedAgentThread({
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
    runPublishedApiThreadReadJson(c, {
      action: AUDIT_ACTION.sessionUpdate,
      operation: async ({ caller, threadId }) => {
        const { retrievePublishedAgentThread } = await loadPublishedAgentThreadService();
        return retrievePublishedAgentThread({
          caller,
          database: c.env.DB,
          threadId,
        });
      },
      threadId: () => parseThreadIdParam(c.req.param("threadId")),
    }),
  );

  v1.get("/threads/:threadId/events", async (c) =>
    runPublishedApiThreadReadJson(c, {
      action: AUDIT_ACTION.sessionUpdate,
      operation: async ({ caller, threadId }) => {
        const { listPublishedAgentThreadEvents } = await loadPublishedAgentThreadService();
        return listPublishedAgentThreadEvents({
          caller,
          database: c.env.DB,
          limit: parseThreadEventsLimit(c.req.query("limit")),
          threadId,
        });
      },
      threadId: () => parseThreadIdParam(c.req.param("threadId")),
    }),
  );

  v1.get("/agents/:agentId/threads", async (c) =>
    runPublishedApiAuthenticatedJson(c, async (caller) =>
      listPublishedAgentThreads(c.env.DB, caller.viewer, {
        agentId: parseAgentIdParam(c.req.param("agentId")),
        archived: parseOptionalBoolean(c.req.query("archived")),
      }),
    ),
  );

  v1.post("/threads/:threadId/events", async (c) => {
    return runPublishedApiSessionMutation(c, {
      action: AUDIT_ACTION.sessionUpdate,
      bodyHash: (prepared) => prepared.bodyHash,
      operation: async ({ auditOptions, caller, prepared, threadId }) => {
        if (threadId === undefined) {
          throw new Error("Thread ID is required.");
        }
        const { sendPublishedAgentSessionEvents } = await loadPublishedAgentCommandService();
        return sendPublishedAgentSessionEvents({
          bindings: c.env,
          caller: caller.viewer,
          executionContext: c.executionCtx,
          input: prepared.body,
          options: auditOptions,
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
    return runPublishedApiSessionMutation(c, {
      action: AUDIT_ACTION.sessionUpdate,
      operation: async ({ auditOptions, caller, threadId }) => {
        if (threadId === undefined) {
          throw new Error("Thread ID is required.");
        }
        const { archivePublishedAgentSession } = await loadPublishedAgentCommandService();
        await archivePublishedAgentSession({
          bindings: c.env,
          caller: caller.viewer,
          options: auditOptions,
          threadId,
        });
        return { ok: true };
      },
      threadId: () => parseThreadIdParam(c.req.param("threadId")),
    });
  });

  v1.post("/threads/:threadId/unarchive", async (c) => {
    return runPublishedApiSessionMutation(c, {
      action: AUDIT_ACTION.sessionUpdate,
      operation: async ({ auditOptions, caller, threadId }) => {
        if (threadId === undefined) {
          throw new Error("Thread ID is required.");
        }
        const { unarchivePublishedAgentSession } = await loadPublishedAgentCommandService();
        await unarchivePublishedAgentSession({
          caller: caller.viewer,
          database: c.env.DB,
          options: auditOptions,
          threadId,
        });
        return { ok: true };
      },
      threadId: () => parseThreadIdParam(c.req.param("threadId")),
    });
  });

  v1.delete("/threads/:threadId", async (c) => {
    return runPublishedApiSessionMutation(c, {
      action: AUDIT_ACTION.sessionDelete,
      operation: async ({ auditOptions, caller, threadId }) => {
        if (threadId === undefined) {
          throw new Error("Thread ID is required.");
        }
        const { deletePublishedAgentSession } = await loadPublishedAgentCommandService();
        await deletePublishedAgentSession({
          bindings: c.env,
          caller: caller.viewer,
          options: auditOptions,
          threadId,
        });
        return { ok: true };
      },
      threadId: () => parseThreadIdParam(c.req.param("threadId")),
    });
  });

  v1.get("/threads/:threadId/files", async (c) =>
    runPublishedApiAuthenticatedJson(c, async (caller) => {
      const { listPublishedSessionFiles } = await loadPublishedSessionFileService();
      return listPublishedSessionFiles(
        c.env.DB,
        caller.viewer,
        parseThreadIdParam(c.req.param("threadId")),
      );
    }),
  );

  v1.post("/threads/:threadId/files", async (c) =>
    runPublishedApiAuthenticatedJson(
      c,
      async (caller) => {
        const { createPublishedSessionFile } = await loadPublishedSessionFileService();
        const body = await readCreateThreadFileRequest(c);
        return createPublishedSessionFile(
          c.env,
          caller.viewer,
          parseThreadIdParam(c.req.param("threadId")),
          body,
        );
      },
      201,
    ),
  );

  v1.delete("/threads/:threadId/files/:fileId", async (c) =>
    runPublishedApiAuthenticatedJson(c, async (caller) => {
      const { deletePublishedSessionFile } = await loadPublishedSessionFileService();
      const threadId = parseThreadIdParam(c.req.param("threadId"));
      await deletePublishedSessionFile(c.env, caller.viewer, {
        fileId: parseFileIdParam(c.req.param("fileId")),
        threadId,
      });
      return { ok: true };
    }),
  );

  app.route(PUBLISHED_AGENT_API_PREFIX, v1);
}
