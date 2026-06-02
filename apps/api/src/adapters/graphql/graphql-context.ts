import type { AuthenticatedViewer } from "../../modules/auth/application/viewer-auth.service";
import type { ApiBindings, ApiServerContext } from "../../platform/cloudflare/worker-types";

export interface GraphQLContext extends ApiServerContext {
  bindings: ApiBindings;
  executionContext: Pick<ExecutionContext, "waitUntil"> | null;
  request: Request;
  serverContext: ApiServerContext;
  viewer: AuthenticatedViewer | null;
}

export interface AuthenticatedGraphQLContext extends GraphQLContext {
  viewer: AuthenticatedViewer;
}
