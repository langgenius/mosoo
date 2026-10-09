import type { SessionProcessEvent } from "@mosoo/contracts/session";
import { SESSION_PROCESS_EVENT_TYPE_BY_CODE } from "@mosoo/contracts/session";
import type { ProjectId, RuntimeEventId, SessionId } from "@mosoo/id";

import { graphql } from "@/gql";
import { requestGraphQL } from "@/platform/http/graphql-client";

const SESSION_PROCESS_EVENT_QUERY_LIMIT = 1000;

const SESSION_PROCESS_EVENTS_QUERY = graphql(/* GraphQL */ `
  query SessionProcessEvents($limit: Int!, $projectId: ULID!, $sessionId: ULID!) {
    threadSessionProcessEvents(limit: $limit, projectId: $projectId, sessionId: $sessionId) {
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

export async function getSessionProcessEvents(
  projectId: ProjectId,
  sessionId: SessionId,
): Promise<SessionProcessEvent[]> {
  const payload = await requestGraphQL(SESSION_PROCESS_EVENTS_QUERY, {
    limit: SESSION_PROCESS_EVENT_QUERY_LIMIT,
    projectId,
    sessionId,
  });

  return payload.threadSessionProcessEvents.map((event) => ({
    content: event.content,
    durationMs: event.durationMs,
    id: event.id as RuntimeEventId,
    occurredAt: event.occurredAt,
    status: event.status,
    tokens: event.tokens,
    type: SESSION_PROCESS_EVENT_TYPE_BY_CODE[event.type],
  }));
}
