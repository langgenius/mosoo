import type { ProjectId, SessionId } from "@mosoo/contracts/id";

import { graphql } from "@/gql";
import { requestGraphQL } from "@/platform/http/graphql-client";

const AUTO_TITLE_SESSION_MUTATION = graphql(/* GraphQL */ `
  mutation AutoTitleSession($input: RenameSessionInput!) {
    autoTitleSession(input: $input) {
      id
    }
  }
`);

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

export async function autoTitleSession(
  projectId: ProjectId,
  sessionId: SessionId,
  title: string,
): Promise<{ _id: string; ok: true; title: string }> {
  const payload = await requestGraphQL(AUTO_TITLE_SESSION_MUTATION, {
    input: { projectId, sessionId, title },
  });

  return {
    _id: payload.autoTitleSession.id,
    ok: true,
    title,
  };
}

export async function archiveAgentSession(
  projectId: ProjectId,
  sessionId: SessionId,
): Promise<{ ok: true }> {
  await requestGraphQL(ARCHIVE_SESSION_MUTATION, { projectId, sessionId });

  return { ok: true };
}

export async function unarchiveAgentSession(
  projectId: ProjectId,
  sessionId: SessionId,
): Promise<{ ok: true }> {
  await requestGraphQL(RESTORE_SESSION_MUTATION, { projectId, sessionId });

  return { ok: true };
}

export async function deleteAgentSession(
  projectId: ProjectId,
  sessionId: SessionId,
): Promise<{ ok: true }> {
  await requestGraphQL(DELETE_AGENT_SESSION_MUTATION, { projectId, sessionId });

  return { ok: true };
}
