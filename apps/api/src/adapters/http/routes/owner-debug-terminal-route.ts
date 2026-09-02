import type { Hono } from "hono";

import { getViewerFromRequest } from "../../../modules/auth/application/viewer-auth.service";
import { connectOwnerDebugTerminalWebSocket } from "../../../modules/runtime/application/owner-debug-terminal.service";
import { createErrorLogContext, logError } from "../../../platform/cloudflare/logger";
import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";
import { isApiError } from "../../../platform/errors";

function unauthorized(): Response {
  return Response.json({ error: "Unauthorized." }, { status: 401 });
}

function errorResponse(error: unknown): Response {
  if (isApiError(error)) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  if (error instanceof Error && error.message === "Agent not found.") {
    return Response.json({ error: error.message }, { status: 404 });
  }

  logError("owner-debug-terminal-route.unexpected-error", createErrorLogContext(error));
  return Response.json({ error: "Owner debug terminal request failed." }, { status: 500 });
}

export function registerOwnerDebugTerminalRoute(app: Hono<ApiGatewayEnvironment>): void {
  app.get("/agent/:agentId/owner-debug-terminal/ws", async (c) => {
    try {
      const viewer = await getViewerFromRequest(c.env, c.req.raw);
      if (!viewer) {
        return unauthorized();
      }

      return await connectOwnerDebugTerminalWebSocket(c.env, {
        agentId: c.req.param("agentId"),
        executionContext: c.executionCtx,
        request: c.req.raw,
        viewer,
      });
    } catch (error) {
      return errorResponse(error);
    }
  });
}
