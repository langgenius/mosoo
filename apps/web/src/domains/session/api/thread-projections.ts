import type { OrganizationId, SessionId } from "@mosoo/contracts/id";
import type {
  SessionProcessEvent,
  SessionThreadUiState,
  UpdateSessionThreadUiStateInput,
} from "@mosoo/contracts/session";

import { graphql } from "@/gql";
import type {
  SessionThreadUiStateListQuery,
  UpdateSessionThreadUiStateMutation,
} from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";
import { toSessionId } from "@/routes/typed-id";

import { SESSION_PROCESS_EVENT_QUERY_LIMIT, toSessionProcessEvent } from "./session-process-events";

const SESSION_THREAD_UI_STATE_LIST_QUERY = graphql(/* GraphQL */ `
  query SessionThreadUiStateList($organizationId: ULID!) {
    sessionThreadUiStateList(organizationId: $organizationId) {
      pinned
      readAt
      sessionId
      updatedAt
    }
  }
`);

const UPDATE_SESSION_THREAD_UI_STATE_MUTATION = graphql(/* GraphQL */ `
  mutation UpdateSessionThreadUiState($input: UpdateSessionThreadUiStateInput!) {
    updateSessionThreadUiState(input: $input) {
      pinned
      readAt
      sessionId
      updatedAt
    }
  }
`);

const SESSION_PROCESS_EVENTS_QUERY = graphql(/* GraphQL */ `
  query SessionProcessEvents($limit: Int!, $sessionId: ULID!) {
    threadSessionProcessEvents(limit: $limit, sessionId: $sessionId) {
      content
      durationMs
      id
      occurredAt
      status
      tokens
      type
    }
  }
`);

function toSessionThreadUiState(
  state:
    | SessionThreadUiStateListQuery["sessionThreadUiStateList"][number]
    | UpdateSessionThreadUiStateMutation["updateSessionThreadUiState"],
): SessionThreadUiState {
  return {
    pinned: state.pinned,
    readAt: state.readAt,
    sessionId: toSessionId(state.sessionId),
    updatedAt: state.updatedAt,
  };
}

export async function listSessionThreadUiStates(
  organizationId: OrganizationId,
): Promise<SessionThreadUiState[]> {
  const payload = await requestGraphQL(SESSION_THREAD_UI_STATE_LIST_QUERY, {
    organizationId,
  });

  return payload.sessionThreadUiStateList.map(toSessionThreadUiState);
}

export async function updateSessionThreadUiState(
  input: UpdateSessionThreadUiStateInput,
): Promise<SessionThreadUiState> {
  const payload = await requestGraphQL(UPDATE_SESSION_THREAD_UI_STATE_MUTATION, {
    input,
  });

  return toSessionThreadUiState(payload.updateSessionThreadUiState);
}

export async function getSessionProcessEvents(
  sessionId: SessionId,
): Promise<SessionProcessEvent[]> {
  const payload = await requestGraphQL(SESSION_PROCESS_EVENTS_QUERY, {
    limit: SESSION_PROCESS_EVENT_QUERY_LIMIT,
    sessionId,
  });

  return payload.threadSessionProcessEvents.map(toSessionProcessEvent);
}
