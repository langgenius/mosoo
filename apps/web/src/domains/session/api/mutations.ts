import type { ProjectId, SessionId } from "@mosoo/id";

import { graphql } from "@/gql";
import { requestGraphQL } from "@/platform/http/graphql-client";

const ARCHIVE_SESSION_MUTATION = graphql(/* GraphQL */ `
  mutation ArchiveSession($projectId: ULID!, $sessionId: ULID!) {
    archiveAgentSession(projectId: $projectId, sessionId: $sessionId) {
      ok
    }
  }
`);

const RESTORE_SESSION_MUTATION = graphql(/* GraphQL */ `
  mutation RestoreSession($projectId: ULID!, $sessionId: ULID!) {
    unarchiveAgentSession(projectId: $projectId, sessionId: $sessionId) {
      ok
    }
  }
`);

const DELETE_AGENT_SESSION_MUTATION = graphql(/* GraphQL */ `
  mutation DeleteAgentSession($projectId: ULID!, $sessionId: ULID!) {
    deleteAgentSession(projectId: $projectId, sessionId: $sessionId) {
      ok
    }
  }
`);

export async function archiveAgentSession(
  projectId: ProjectId,
  sessionId: SessionId,
): Promise<void> {
  await requestGraphQL(ARCHIVE_SESSION_MUTATION, { projectId, sessionId });
}

export async function unarchiveAgentSession(
  projectId: ProjectId,
  sessionId: SessionId,
): Promise<void> {
  await requestGraphQL(RESTORE_SESSION_MUTATION, { projectId, sessionId });
}

export async function deleteAgentSession(
  projectId: ProjectId,
  sessionId: SessionId,
): Promise<void> {
  await requestGraphQL(DELETE_AGENT_SESSION_MUTATION, { projectId, sessionId });
}
