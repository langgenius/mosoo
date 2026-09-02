import { PUBLIC_API_PREFIX } from "@mosoo/contracts/public-api";
import { Hono } from "hono";
import { cors } from "hono/cors";

import {
  createErrorLogContext,
  createRequestLogContext,
  logError,
} from "../../platform/cloudflare/logger";
import type { ApiGatewayEnvironment } from "../../platform/cloudflare/worker-types";
import { requestLoggingMiddleware } from "./request-logging.middleware";
import { registerAccessTokenRoute } from "./routes/access-token-route";
import { registerAuthRoute } from "./routes/auth-route";
import { registerDriverRoute } from "./routes/driver-route";
import { registerFileRoute } from "./routes/file-route";
import { registerGraphQLRoute } from "./routes/graphql-route";
import { registerHealthRoute } from "./routes/health-route";
import { registerMcpRoute } from "./routes/mcp-route";
import { registerOwnerDebugTerminalRoute } from "./routes/owner-debug-terminal-route";
import { registerPublicApiRoute } from "./routes/public-api-route";
import { registerRootRoute } from "./routes/root-route";
import { registerSkillRoute } from "./routes/skill-route";

export function createHttpApp() {
  const project = new Hono<ApiGatewayEnvironment>();
  const publicApi = new Hono<ApiGatewayEnvironment>();
  const graphQLCorsMiddleware = cors({
    allowHeaders: ["Content-Type"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    origin: (_origin, c) => c.env.WEB_ORIGIN,
  });

  project.use("*", requestLoggingMiddleware());
  publicApi.use("/graphql", graphQLCorsMiddleware);

  registerDriverRoute(project);
  registerRootRoute(project);
  registerHealthRoute(publicApi);
  registerAccessTokenRoute(publicApi);
  registerAuthRoute(publicApi);
  registerFileRoute(publicApi);
  registerMcpRoute(publicApi);
  registerOwnerDebugTerminalRoute(publicApi);
  registerPublicApiRoute(publicApi);
  registerSkillRoute(publicApi);
  registerGraphQLRoute(publicApi);
  project.route(PUBLIC_API_PREFIX, publicApi);

  project.notFound((c) =>
    c.json(
      {
        error: "Not Found",
      },
      404,
    ),
  );

  project.onError((error, c) => {
    const url = new URL(c.req.url);

    logError("request.failed", {
      ...createRequestLogContext(c.req.raw),
      ...createErrorLogContext(error),
      path: url.pathname,
    });

    return c.json(
      {
        error: "Internal Server Error",
      },
      500,
    );
  });

  return project;
}
