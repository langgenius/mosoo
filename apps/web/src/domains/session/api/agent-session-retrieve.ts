import type { ProjectId, SessionId } from "@mosoo/id";

import { graphql } from "@/gql";
import type { AgentSessionDiagnosticsQuery } from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";

const AGENT_SESSION_DIAGNOSTICS_QUERY = graphql(/* GraphQL */ `
  query AgentSessionDiagnostics($projectId: ULID!, $sessionId: ULID!) {
    agentSessionDiagnostics(projectId: $projectId, sessionId: $sessionId) {
      execution {
        binding {
          deploymentVersionId
          deploymentVersionNumber
          model
          provider
          runtimeId
          sessionId
        }
        skills {
          skillId
          skillName
        }
        tools {
          credentialMode
          serverId
        }
      }
      generatedAt
      nativeRuntimeRef {
        kind
        runtimeId
        status
        valuePreview
      }
      session {
        deploymentVersionId
        deploymentVersionNumber
        id
        lastRun {
          deploymentVersionId
          deploymentVersionNumber
          id
          model
          provider
          status
          traceId
        }
        model
        provider
        runtimeId
        status
        title
      }
    }
  }
`);

export async function getAgentSessionDiagnostics(input: {
  projectId: ProjectId;
  sessionId: SessionId;
}): Promise<AgentSessionDiagnosticsQuery> {
  return requestGraphQL(AGENT_SESSION_DIAGNOSTICS_QUERY, {
    projectId: input.projectId,
    sessionId: input.sessionId,
  });
}
