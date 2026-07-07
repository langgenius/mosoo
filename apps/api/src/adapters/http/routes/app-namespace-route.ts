/**
 * Name-addressed App API namespace routes (PRD "API Namespace & Access"):
 *
 *   POST /api/v1/apps/{appSlug}/agents/{agentName}/threads
 *   GET  /api/v1/apps/{appSlug}/agents/{agentName}/threads
 *   GET  /api/v1/apps/{appSlug}/openapi.json
 *
 * The thread routes are pure address adapters over the ULID surface: the
 * slug resolves to an App (minted at the first protocol deploy), the name
 * resolves to the single exposed+published Agent, and the request then rides
 * the exact same run wrappers as /agents/{agentId}/threads — identical PAT
 * authentication, rate limiting, idempotency, and admission
 * (admitPublicThreadCreator inside createPublicThread). Thread-level
 * operations stay ULID-addressed; create responses keep their
 * /threads/{threadId} links.
 *
 * Anti-enumeration: every resolution miss — unknown slug, unknown name,
 * un-exposed or unpublished Agent, and duplicate exposed names (no
 * (app_id, name) unique index in v1; the native upsert blocks duplicates on
 * protocol Apps) — renders the same publicNotFound, so callers cannot probe
 * which slugs or names exist through the authenticated routes.
 */
import type { AgentId } from "@mosoo/id";
import type { Context, Hono } from "hono";

import {
  listExposedAgentApiEndpointRowsByName,
  listExposedAgentApiNames,
} from "../../../modules/agents/application/agent-repository";
import { getAppRowBySlug } from "../../../modules/apps/application/app.service";
import { publicNotFound, toPublicApiError } from "../../../modules/public-api/public-api-errors";
import { listAgentApiEndpointThreads } from "../../../modules/public-api/public-thread-session-query.service";
import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";
import { createAppNamespaceOpenApiDocument } from "./app-namespace-openapi";
import {
  runPublicApiAuthenticatedJson,
  runPublicApiThreadMutation,
} from "./public-api-route-support";
import {
  hashCreateThreadIdempotencyBody,
  parseAgentNameParam,
  parseAppSlugParam,
  parseOptionalBoolean,
  readCreateThreadRequest,
} from "./public-thread-api-request";

type AppNamespaceRouteContext = Context<ApiGatewayEnvironment>;

async function loadPublicThreadService() {
  return import("../../../modules/public-api/public-thread-api.service");
}

/**
 * Resolves {appSlug, agentName} to the single routable Agent ULID. Runs
 * inside the shared wrappers' try block, after PAT authentication, so a
 * missing token is always a 401 before any resolution answer leaks.
 */
async function resolveAppNamespaceAgentId(c: AppNamespaceRouteContext): Promise<AgentId> {
  const appSlug = parseAppSlugParam(c.req.param("appSlug") ?? "");
  const agentName = parseAgentNameParam(c.req.param("agentName") ?? "");
  const app = await getAppRowBySlug(c.env.DB, appSlug);

  if (app === null) {
    throw publicNotFound("Agent not found.");
  }

  const rows = await listExposedAgentApiEndpointRowsByName(c.env.DB, {
    appId: app.id,
    name: agentName,
  });
  const agent = rows.length === 1 ? rows[0] : undefined;

  if (agent === undefined) {
    throw publicNotFound("Agent not found.");
  }

  return agent.id;
}

/**
 * The namespace OpenAPI route sits outside the PAT wrappers (unauthenticated
 * by design), so it renders its own public error shape for slug parse
 * failures and unknown namespaces. Anything non-public rethrows to the
 * platform handler.
 */
function toAppNamespaceErrorResponse(error: unknown): Response {
  const publicError = toPublicApiError(error);

  if (publicError === null) {
    throw error;
  }

  return Response.json(
    {
      error: {
        code: publicError.code,
        message: publicError.message,
      },
    },
    { status: publicError.status },
  );
}

/** Registered from registerPublicApiRoute before the v1 mount. */
export function registerAppNamespaceRoute(v1: Hono<ApiGatewayEnvironment>) {
  v1.get("/apps/:appSlug/openapi.json", async (c) => {
    try {
      const appSlug = parseAppSlugParam(c.req.param("appSlug") ?? "");
      const app = await getAppRowBySlug(c.env.DB, appSlug);

      if (app === null) {
        throw publicNotFound("App not found.");
      }

      return c.json(
        createAppNamespaceOpenApiDocument({
          agentNames: await listExposedAgentApiNames(c.env.DB, app.id),
          appSlug,
          origin: new URL(c.req.url).origin,
        }),
      );
    } catch (error) {
      return toAppNamespaceErrorResponse(error);
    }
  });

  v1.post("/apps/:appSlug/agents/:agentName/threads", async (c) =>
    runPublicApiThreadMutation(c, {
      agentId: () => resolveAppNamespaceAgentId(c),
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
    }),
  );

  v1.get("/apps/:appSlug/agents/:agentName/threads", async (c) =>
    runPublicApiAuthenticatedJson(c, async (caller) =>
      listAgentApiEndpointThreads(c.env.DB, caller.viewer, {
        agentId: await resolveAppNamespaceAgentId(c),
        archived: parseOptionalBoolean(c.req.query("archived")),
      }),
    ),
  );
}
