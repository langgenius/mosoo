import { PUBLIC_API_PREFIX } from "@mosoo/contracts/public-api";
import { Hono } from "hono";

import type { ApiGatewayEnvironment } from "../../platform/cloudflare/worker-types";
import { requestLoggingMiddleware } from "./request-logging.middleware";
import { registerAccessTokenRoute } from "./routes/access-token-route";
import { registerAuthRoute } from "./routes/auth-route";
import { registerDriverRoute } from "./routes/driver-route";
import { registerFileRoute } from "./routes/file-route";
import { registerGraphQLRoute } from "./routes/graphql-route";
import { registerHealthRoute } from "./routes/health-route";
import { registerMcpRoute } from "./routes/mcp-route";
import { registerPublicApiRoute } from "./routes/public-api-route";
import { registerRootRoute } from "./routes/root-route";
import { registerSkillRoute } from "./routes/skill-route";

export function createHttpApp() {
  const app = new Hono<ApiGatewayEnvironment>();
  const publicApi = new Hono<ApiGatewayEnvironment>();

  app.use("*", requestLoggingMiddleware());

  registerDriverRoute(app);
  registerRootRoute(app);
  registerHealthRoute(publicApi);
  registerAccessTokenRoute(publicApi);
  registerAuthRoute(publicApi);
  registerFileRoute(publicApi);
  registerMcpRoute(publicApi);
  registerPublicApiRoute(publicApi);
  registerSkillRoute(publicApi);
  registerGraphQLRoute(publicApi);
  app.route(PUBLIC_API_PREFIX, publicApi);

  app.notFound((c) =>
    c.json(
      {
        error: "Not Found",
      },
      404,
    ),
  );

  // The request logging middleware records the error on its http.request event.
  app.onError((_error, c) =>
    c.json(
      {
        error: "Internal Server Error",
      },
      500,
    ),
  );

  return app;
}
