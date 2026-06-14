import type { AppId, SessionId } from "@mosoo/contracts/id";

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
  mutation ArchiveSession($appId: ULID!, $sessionId: ULID!) {
    archiveAgentSession(appId: $appId, sessionId: $sessionId) {
      ok
    }
  }
`);

const RESTORE_SESSION_MUTATION = graphql(/* GraphQL */ `
  mutation RestoreSession($appId: ULID!, $sessionId: ULID!) {
    unarchiveAgentSession(appId: $appId, sessionId: $sessionId) {
      ok
    }
  }
`);

const DELETE_AGENT_SESSION_MUTATION = graphql(/* GraphQL */ `
  mutation DeleteAgentSession($appId: ULID!, $sessionId: ULID!) {
    deleteAgentSession(appId: $appId, sessionId: $sessionId) {
      ok
    }
  }
`);

export async function autoTitleSession(
  appId: AppId,
  sessionId: SessionId,
  title: string,
): Promise<{ _id: string; ok: true; title: string }> {
  const payload = await requestGraphQL(AUTO_TITLE_SESSION_MUTATION, {
    input: { appId, sessionId, title },
  });

  return {
    _id: payload.autoTitleSession.id,
    ok: true,
    title,
  };
}

export async function archiveAgentSession(
  appId: AppId,
  sessionId: SessionId,
): Promise<{ ok: true }> {
  await requestGraphQL(ARCHIVE_SESSION_MUTATION, { appId, sessionId });

  return { ok: true };
}

export async function unarchiveAgentSession(
  appId: AppId,
  sessionId: SessionId,
): Promise<{ ok: true }> {
  await requestGraphQL(RESTORE_SESSION_MUTATION, { appId, sessionId });

  return { ok: true };
}

export async function deleteAgentSession(
  appId: AppId,
  sessionId: SessionId,
): Promise<{ ok: true }> {
  await requestGraphQL(DELETE_AGENT_SESSION_MUTATION, { appId, sessionId });

  return { ok: true };
}
