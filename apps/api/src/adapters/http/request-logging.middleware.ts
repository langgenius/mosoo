import type { MiddlewareHandler } from "hono";

import {
  createApiWideEvent,
  createRequestLogContext,
  emitApiWideEvent,
  runWithRequestLogContext,
} from "../../platform/cloudflare/logger";
import type { ApiGatewayEnvironment } from "../../platform/cloudflare/worker-types";

export function requestLoggingMiddleware(): MiddlewareHandler<ApiGatewayEnvironment> {
  return async (c, next) =>
    runWithRequestLogContext(c.req.raw, async () => {
      const startedAt = Date.now();
      let requestError: unknown = null;
      const requestEvent = createApiWideEvent("http.request", {
        fields: {
          http: createRequestLogContext(c.req.raw),
        },
      });

      try {
        await next();
      } catch (error) {
        requestError = error;
        requestEvent.setError(error, createRequestLogContext(c.req.raw));
        throw error;
      } finally {
        const url = new URL(c.req.url);
        const statusCode = requestError ? 500 : c.res.status;

        requestEvent.merge("http", {
          duration_ms: Date.now() - startedAt,
          path: url.pathname,
          status_code: statusCode,
        });

        emitApiWideEvent(requestEvent, {
          ...(requestError instanceof Error ? { error: requestError } : {}),
          status: statusCode >= 500 ? "error" : "success",
        });
      }
    });
}
