import type { AuthenticatedViewer } from "../../modules/auth/application/viewer-auth.service";
import type { ApiBindings } from "../../platform/cloudflare/worker-types";

export interface GraphQLContext {
  bindings: ApiBindings;
  executionContext: Pick<ExecutionContext, "waitUntil"> | null;
  request: Request;
  viewer: AuthenticatedViewer | null;
}

export interface AuthenticatedGraphQLContext extends GraphQLContext {
  viewer: AuthenticatedViewer;
}
