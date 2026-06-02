import type { Hono } from "hono";

import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";
import type { createGraphQLGateway } from "../../graphql/create-graphql-gateway";

let gatewayPromise: Promise<ReturnType<typeof createGraphQLGateway>> | null = null;

async function getGraphQLGateway(): Promise<ReturnType<typeof createGraphQLGateway>> {
  gatewayPromise ??= import("../../graphql/create-graphql-gateway").then(
    ({ createGraphQLGateway }) => createGraphQLGateway(),
  );

  return gatewayPromise;
}

export function registerGraphQLRoute(app: Hono<ApiGatewayEnvironment>) {
  app.all("/graphql", async (c) => {
    const graphqlGateway = await getGraphQLGateway();

    // @ts-expect-error -- Cloudflare Request<unknown, CfProperties> vs whatwg-node Request
    return graphqlGateway.fetch(c.req.raw, {
      ...c.env,
      executionCtx: c.executionCtx,
    });
  });
}
