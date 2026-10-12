import { PUBLIC_API_PREFIX } from "@mosoo/contracts/public-api";
import { createYoga, isAsyncIterable } from "graphql-yoga";
import type { Plugin } from "graphql-yoga";

import { getApiViewerFromRequest } from "../../modules/auth/application/viewer-auth.service";
import type { AuthenticatedViewer } from "../../modules/auth/application/viewer-auth.service";
import {
  captureServerProductEvent,
  SERVER_PRODUCT_ANALYTICS_EVENTS,
} from "../../platform/analytics/product-analytics";
import { createGraphQLSchema } from "./create-graphql-schema";
import type { GraphQLContext } from "./graphql-context";
const schema = createGraphQLSchema();

export function createGraphQLGateway() {
  const tokenRequests = new WeakMap<
    Request,
    { viewer: AuthenticatedViewer; graphqlErrorCount?: number }
  >();

  return createYoga<
    Pick<GraphQLContext, "bindings" | "executionContext">,
    Pick<GraphQLContext, "viewer">
  >({
    context: async ({ bindings, request }) => {
      const viewer = await getApiViewerFromRequest(bindings, request);
      // Cookie authentication takes precedence over a bearer token in the same request.
      if (viewer?.apiKeyId !== undefined) {
        tokenRequests.set(request, { viewer });
      }
      return { viewer };
    },
    graphiql: true,
    graphqlEndpoint: `${PUBLIC_API_PREFIX}/graphql`,
    plugins: [
      {
        onResultProcess({ request, result }) {
          const tokenRequest = tokenRequests.get(request);
          if (!tokenRequest || isAsyncIterable(result)) {
            return;
          }
          const results = Array.isArray(result) ? result : [result];
          tokenRequest.graphqlErrorCount = results.reduce(
            (count, operation) => count + (operation.errors?.length ?? 0),
            0,
          );
        },
        onResponse({ request, response, serverContext }) {
          const tokenRequest = tokenRequests.get(request);
          tokenRequests.delete(request);
          if (!tokenRequest) {
            return;
          }
          const { viewer, graphqlErrorCount } = tokenRequest;
          serverContext.executionContext?.waitUntil(
            captureServerProductEvent(serverContext.bindings, {
              distinctId: viewer.id,
              event: SERVER_PRODUCT_ANALYTICS_EVENTS.apiRequestCompleted,
              properties: {
                api_key_id: viewer.apiKeyId,
                api_surface: "graphql",
                credential_type: viewer.projectId === undefined ? "cli_login" : "project_key",
                graphql_error_count: graphqlErrorCount,
                http_method: request.method,
                is_internal: viewer.email.trim().toLowerCase().endsWith("@dify.ai"),
                project_id: viewer.projectId,
                request_succeeded: response.ok && graphqlErrorCount === 0,
                route: `${PUBLIC_API_PREFIX}/graphql`,
                status_code: response.status,
              },
            }),
          );
        },
      } satisfies Plugin<GraphQLContext, Pick<GraphQLContext, "bindings" | "executionContext">>,
    ],
    schema,
  });
}
