import type { ProjectId, SessionId } from "@mosoo/contracts/id";
import type { SessionProcessEvent } from "@mosoo/contracts/session";

import { graphql } from "@/gql";
import { requestGraphQL } from "@/platform/http/graphql-client";

import { SESSION_PROCESS_EVENT_QUERY_LIMIT, toSessionProcessEvent } from "./session-process-events";

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

  return payload.threadSessionProcessEvents.map(toSessionProcessEvent);
}
