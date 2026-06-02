import type { SessionId } from "@mosoo/contracts/id";

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
  mutation ArchiveSession($sessionId: ULID!) {
    archiveAgentSession(sessionId: $sessionId) {
      ok
    }
  }
`);

const RESTORE_SESSION_MUTATION = graphql(/* GraphQL */ `
  mutation RestoreSession($sessionId: ULID!) {
    unarchiveAgentSession(sessionId: $sessionId) {
      ok
    }
  }
`);

const DELETE_AGENT_SESSION_MUTATION = graphql(/* GraphQL */ `
  mutation DeleteAgentSession($sessionId: ULID!) {
    deleteAgentSession(sessionId: $sessionId) {
      ok
    }
  }
`);

export async function autoTitleSession(
  sessionId: SessionId,
  title: string,
): Promise<{ _id: string; ok: true; title: string }> {
  const payload = await requestGraphQL(AUTO_TITLE_SESSION_MUTATION, {
    input: { sessionId, title },
  });

  return {
    _id: payload.autoTitleSession.id,
    ok: true,
    title,
  };
}

export async function archiveAgentSession(sessionId: SessionId): Promise<{ ok: true }> {
  await requestGraphQL(ARCHIVE_SESSION_MUTATION, { sessionId });

  return { ok: true };
}

export async function unarchiveAgentSession(sessionId: SessionId): Promise<{ ok: true }> {
  await requestGraphQL(RESTORE_SESSION_MUTATION, { sessionId });

  return { ok: true };
}

export async function deleteAgentSession(sessionId: SessionId): Promise<{ ok: true }> {
  await requestGraphQL(DELETE_AGENT_SESSION_MUTATION, { sessionId });

  return { ok: true };
}
