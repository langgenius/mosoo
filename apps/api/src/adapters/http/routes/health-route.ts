import type { Hono } from "hono";

import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";

export function registerHealthRoute(app: Hono<ApiGatewayEnvironment>) {
  app.get("/health", (c) =>
    c.json({
      name: c.env.APP_NAME,
      ok: true,
    }),
  );
}
