import type { SessionRuntimeOperationInput } from "@mosoo/contracts/session";

import { graphql } from "@/gql";
import { requestGraphQL } from "@/platform/http/graphql-client";

const RESTART_SESSION_DRIVER = graphql(/* GraphQL */ `
  mutation RestartSessionDriver($projectId: ULID!, $sessionId: ULID!) {
    restartSessionDriver(projectId: $projectId, sessionId: $sessionId) {
      ok
      sessionId
    }
  }
`);
const RECREATE_SESSION_SANDBOX = graphql(/* GraphQL */ `
  mutation RecreateSessionSandbox($projectId: ULID!, $sessionId: ULID!) {
    recreateSessionSandbox(projectId: $projectId, sessionId: $sessionId) {
      ok
      sessionId
    }
  }
`);

export function restartSessionDriver(input: SessionRuntimeOperationInput) {
  return requestGraphQL(RESTART_SESSION_DRIVER, input);
}

export function recreateSessionSandbox(input: SessionRuntimeOperationInput) {
  return requestGraphQL(RECREATE_SESSION_SANDBOX, input);
}
