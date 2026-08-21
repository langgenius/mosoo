import type { MiddlewareHandler } from "hono";

import { APP_AGENT_BOUND_PATH_PREFIX } from "../../modules/public-api/app-agent-capability";
import {
  createApiWideEvent,
  createRequestLogContext,
  emitApiWideEvent,
  runWithRequestLogContext,
} from "../../platform/cloudflare/logger";
import type { ApiGatewayEnvironment } from "../../platform/cloudflare/worker-types";

/**
 * A bound capability URL is a bearer secret carried in the path. Request logs
 * keep the route shape (`/api/v1/bound/:token/...`) and never the token.
 */
export function redactRequestLogPath(pathname: string): string {
  const prefix = `${APP_AGENT_BOUND_PATH_PREFIX}/`;

  if (!pathname.startsWith(prefix)) {
    return pathname;
  }

  const remainder = pathname.slice(prefix.length);
  const nextSlash = remainder.indexOf("/");

  return `${APP_AGENT_BOUND_PATH_PREFIX}/:token${nextSlash === -1 ? "" : remainder.slice(nextSlash)}`;
}

function createRedactedRequestLogContext(request: Request) {
  return {
    ...createRequestLogContext(request),
    path: redactRequestLogPath(new URL(request.url).pathname),
  };
}

export function requestLoggingMiddleware(): MiddlewareHandler<ApiGatewayEnvironment> {
  return async (c, next) =>
    runWithRequestLogContext(c.req.raw, async () => {
      const startedAt = Date.now();
      let requestError: unknown = null;
      const requestEvent = createApiWideEvent("http.request", {
        fields: {
          http: createRedactedRequestLogContext(c.req.raw),
        },
      });

      try {
        await next();
      } catch (error) {
        requestError = error;
        requestEvent.setError(error, createRedactedRequestLogContext(c.req.raw));
        throw error;
      } finally {
        const url = new URL(c.req.url);
        const statusCode = requestError ? 500 : c.res.status;

        requestEvent.merge("http", {
          duration_ms: Date.now() - startedAt,
          path: redactRequestLogPath(url.pathname),
          status_code: statusCode,
        });

        emitApiWideEvent(requestEvent, {
          ...(requestError instanceof Error ? { error: requestError } : {}),
          status: statusCode >= 500 ? "error" : "success",
        });
      }
    });
}
