import type { PublicApiVersion } from "@mosoo/contracts/public-api";
import type { MiddlewareHandler } from "hono";
import { routePath } from "hono/route";

import {
  captureServerProductEvent,
  SERVER_PRODUCT_ANALYTICS_EVENTS,
} from "../../platform/analytics/product-analytics";
import type { ApiGatewayEnvironment } from "../../platform/cloudflare/worker-types";

export function publicApiAnalyticsMiddleware(
  apiVersion: PublicApiVersion,
): MiddlewareHandler<ApiGatewayEnvironment> {
  return async (c, next) => {
    await next();

    const caller = c.get("publicApiCaller");
    if (caller === undefined || c.req.method === "OPTIONS" || !c.env.POSTHOG_PROJECT_KEY?.trim()) {
      return;
    }

    const statusCode = c.res.status;
    c.executionCtx.waitUntil(
      captureServerProductEvent(c.env, {
        distinctId: caller.viewer.id,
        event: SERVER_PRODUCT_ANALYTICS_EVENTS.apiRequestCompleted,
        properties: {
          api_key_id: caller.tokenId,
          api_surface: "public_api",
          api_version: apiVersion,
          credential_type: caller.viewer.projectId === undefined ? "cli_login" : "project_key",
          http_method: c.req.method,
          idempotency_replayed: c.res.headers.get("Idempotency-Replayed") === "true",
          is_internal: caller.viewer.email.trim().toLowerCase().endsWith("@dify.ai"),
          project_id: caller.viewer.projectId,
          request_succeeded: statusCode >= 200 && statusCode < 300,
          route: routePath(c),
          status_code: statusCode,
        },
      }),
    );
  };
}
