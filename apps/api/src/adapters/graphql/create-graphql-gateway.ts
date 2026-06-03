import { PUBLIC_API_PREFIX } from "@mosoo/contracts/public-api";
import { createYoga } from "graphql-yoga";

import {
  authenticatePersonalAccessToken,
  readBearerToken,
} from "../../modules/auth/application/personal-access-token.service";
import { getViewerFromRequest } from "../../modules/auth/application/viewer-auth.service";
import type { ApiServerContext } from "../../platform/cloudflare/worker-types";
import { isTruthy } from "../../shared/truthiness";
import { createGraphQLSchema } from "./create-graphql-schema";
import type { GraphQLContext } from "./graphql-context";
const schema = createGraphQLSchema();

export function createGraphQLGateway() {
  return createYoga<ApiServerContext, GraphQLContext>({
    context: async ({ request, ...serverContext }) => {
      const { executionCtx: executionContext, ...bindings } = serverContext;
      const sessionViewer = await getViewerFromRequest(bindings, request);
      const token = sessionViewer ? null : readBearerToken(request);
      const tokenCaller = isTruthy(token)
        ? await authenticatePersonalAccessToken(bindings.DB, token)
        : null;
      const viewer = tokenCaller ? tokenCaller.viewer : sessionViewer;

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
