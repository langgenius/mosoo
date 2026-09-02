import type { Hono } from "hono";

import { completeMcpOAuthCallback } from "../../../modules/mcp/application/mcp-oauth.service";
import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";

export function registerMcpRoute(app: Hono<ApiGatewayEnvironment>) {
  app.get("/mcp/oauth/callback", async (c) => completeMcpOAuthCallback(c.env, c.req.raw));
}
