import type { Hono } from "hono";

import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";

export function registerHealthRoute(app: Hono<ApiGatewayEnvironment>) {
  app.get("/health", async (c) => {
    if (c.req.query("deep") !== "1") {
      return c.json({
        name: c.env.APP_NAME,
        ok: true,
      });
    }

    // Three sequential round trips measure Worker->D1 RTT rather than
    // throughput; placement drift between a Worker and its D1 instance is
    // otherwise invisible and gets misdiagnosed as slow code.
    const d1PingsMs: number[] = [];

    for (let index = 0; index < 3; index += 1) {
      const startedAtMs = Date.now();

      await c.env.DB.prepare("SELECT 1").first();
      d1PingsMs.push(Date.now() - startedAtMs);
    }

    return c.json({
      d1PingsMs,
      name: c.env.APP_NAME,
      ok: true,
    });
  });
}
