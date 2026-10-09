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
      const requestEvent = createApiWideEvent("http.request", {
        fields: {
          http: createRequestLogContext(c.req.raw),
        },
      });

      // Hono hands handler errors to onError and records them on c.error, so
      // next() resolves with the error response instead of throwing.
      await next();

      const statusCode = c.res.status;
      // A mapped client error can quote the request (a JSON SyntaxError quotes
      // the body), so only server errors attach their error to the log.
      const loggedError = statusCode >= 500 ? c.error : undefined;

      if (loggedError !== undefined) {
        requestEvent.setError(loggedError, createRequestLogContext(c.req.raw));
      }

      requestEvent.merge("http", {
        duration_ms: Date.now() - startedAt,
        path: new URL(c.req.url).pathname,
        status_code: statusCode,
      });

      emitApiWideEvent(requestEvent, {
        ...(loggedError === undefined ? {} : { error: loggedError }),
        status: statusCode >= 500 ? "error" : "success",
      });
    });
}
