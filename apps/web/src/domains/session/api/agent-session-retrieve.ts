import type { ProjectId, SessionId } from "@mosoo/contracts/id";

import { graphql } from "@/gql";
import type { AgentSessionDiagnosticsQuery, ThreadAgentSessionRetrieveQuery } from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";

export interface ThreadAgentSessionRetrieveResult {
  agentSessionRetrieve: ThreadAgentSessionRetrieveQuery["threadAgentSessionRetrieve"];
}

const THREAD_AGENT_SESSION_RETRIEVE_QUERY = graphql(/* GraphQL */ `
  query ThreadAgentSessionRetrieve($projectId: ULID!, $sessionId: ULID!) {
    threadAgentSessionRetrieve(projectId: $projectId, sessionId: $sessionId) {
      capabilities {
        action
        reason
        status
      }
      recoverability {
        reason
        status
      }
      taskSnapshot {
        runId
        tasks {
          taskId
          taskType
          title
        }
      }
      session {
        agentId
        archivedAt
        createdAt
        deploymentVersionId
        deploymentVersionNumber
        id
        kind
        lastMessageAt
        lastRun {
          completedAt
          createdAt
          deploymentVersionId
          deploymentVersionNumber
          error {
            code
            details
            message
            retryable
          }
          id
          model
          provider
          startedAt
          status
          traceId
          trigger
          updatedAt
        }
        model
        provider
        projectId
        runtimeId
        status
        title
        updatedAt
      }
    }
  }
`);

const AGENT_SESSION_DIAGNOSTICS_QUERY = graphql(/* GraphQL */ `
  query AgentSessionDiagnostics($projectId: ULID!, $sessionId: ULID!) {
    agentSessionDiagnostics(projectId: $projectId, sessionId: $sessionId) {
      execution {
        binding {
          deploymentVersionId
          deploymentVersionNumber
          kind
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
      pendingPermissionCount
      session {
        deploymentVersionId
        deploymentVersionNumber
        id
        kind
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

export async function retrieveThreadAgentSession(input: {
  projectId: ProjectId;
  sessionId: SessionId;
}): Promise<ThreadAgentSessionRetrieveResult> {
  const payload = await requestGraphQL(THREAD_AGENT_SESSION_RETRIEVE_QUERY, {
    projectId: input.projectId,
    sessionId: input.sessionId,
  });

  return {
    agentSessionRetrieve: payload.threadAgentSessionRetrieve,
  };
}

export async function getAgentSessionDiagnostics(input: {
  projectId: ProjectId;
  sessionId: SessionId;
}): Promise<AgentSessionDiagnosticsQuery> {
  return requestGraphQL(AGENT_SESSION_DIAGNOSTICS_QUERY, {
    projectId: input.projectId,
    sessionId: input.sessionId,
  });
}
