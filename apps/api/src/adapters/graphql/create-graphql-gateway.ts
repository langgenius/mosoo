import { PUBLIC_API_PREFIX } from "@mosoo/contracts/public-api";
import { createYoga } from "graphql-yoga";

import { getAuthenticatedViewerFromRequest } from "../../modules/auth/application/viewer-auth.service";
import type { ApiServerContext } from "../../platform/cloudflare/worker-types";
import { createGraphQLSchema } from "./create-graphql-schema";
import type { GraphQLContext } from "./graphql-context";
const schema = createGraphQLSchema();

export function createGraphQLGateway() {
  return createYoga<ApiServerContext, GraphQLContext>({
    context: async ({ request, ...serverContext }) => {
      const { executionCtx: executionContext, ...bindings } = serverContext;
      const viewer = await getAuthenticatedViewerFromRequest(bindings, request);

      return {
        ...serverContext,
        bindings,
        executionContext,
        request,
        serverContext,
        viewer,
      };
    },
    graphiql: true,
    graphqlEndpoint: `${PUBLIC_API_PREFIX}/graphql`,
    schema,
  });
}
