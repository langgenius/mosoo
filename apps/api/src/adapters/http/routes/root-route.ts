import { PUBLIC_API_PREFIX } from "@mosoo/contracts/public-api";
import type { Hono } from "hono";

import { getViewerFromRequest } from "../../../modules/auth/application/viewer-auth.service";
import { connectAuthenticatedSessionViewerWebSocket } from "../../../modules/sessions/application/session-viewer-socket.service";
import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";

export function registerRootRoute(app: Hono<ApiGatewayEnvironment>) {
  app.get("/", (c) => c.redirect(`${PUBLIC_API_PREFIX}/graphql`));

  app.get(`${PUBLIC_API_PREFIX}/ag-ui/session/:sessionId/ws`, async (c) => {
    const viewer = await getViewerFromRequest(c.env, c.req.raw);

    if (!viewer) {
      return c.json(
        {
          error: "Unauthorized.",
        },
        401,
      );
    }

    const projectId = c.req.query("projectId");

    if (projectId === undefined) {
      return c.json({ error: "projectId is required." }, 400);
    }

    try {
      return await connectAuthenticatedSessionViewerWebSocket(c.env, {
        projectId,
        request: c.req.raw,
        sessionId: c.req.param("sessionId"),
        viewer,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "Session is archived.") {
        return c.json({ error: error.message }, 409);
      }

      throw error;
    }
  });
}
