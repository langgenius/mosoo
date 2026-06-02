import { Hono } from "hono";

import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";

function isAuthConfigured(bindings: Pick<ApiGatewayEnvironment["Bindings"], "BETTER_AUTH_SECRET">) {
  return Boolean(bindings.BETTER_AUTH_SECRET?.trim());
}

export function registerAuthRoute(app: Hono<ApiGatewayEnvironment>) {
  const auth = new Hono<ApiGatewayEnvironment>();

  auth.on(["GET", "POST"], "/*", async (c) => {
    if (!isAuthConfigured(c.env)) {
      return c.json(
        {
          error: "Auth is not configured.",
        },
        503,
      );
    }

    const { getBetterAuth } =
      await import("../../../modules/auth/application/auth-session.service");

    return getBetterAuth(c.env).handler(c.req.raw);
  });

  app.route("/auth", auth);
}
