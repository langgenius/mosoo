import { PUBLIC_API_PREFIX } from "@mosoo/contracts/public-api";
import { createYoga } from "graphql-yoga";

import { getApiViewerFromRequest } from "../../modules/auth/application/viewer-auth.service";
import { createGraphQLSchema } from "./create-graphql-schema";
import type { GraphQLContext } from "./graphql-context";
const schema = createGraphQLSchema();

export function createGraphQLGateway() {
  return createYoga<
    Pick<GraphQLContext, "bindings" | "executionContext">,
    Pick<GraphQLContext, "viewer">
  >({
    context: async ({ bindings, request }) => ({
      viewer: await getApiViewerFromRequest(bindings, request),
    }),
    graphiql: true,
    graphqlEndpoint: `${PUBLIC_API_PREFIX}/graphql`,
    schema,
  });
}
