import type { AgentId } from "@mosoo/contracts/id";

import { graphql } from "@/gql";
import type { AgentRuntimeEventFamily, AgentRuntimeEventsQuery } from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";

export type AgentRuntimeEvent = AgentRuntimeEventsQuery["agentRuntimeEvents"]["nodes"][number];
export type AgentRuntimeEventConnection = AgentRuntimeEventsQuery["agentRuntimeEvents"];

const AGENT_RUNTIME_EVENTS_QUERY = graphql(/* GraphQL */ `
  query AgentRuntimeEvents(
    $agentId: ULID!
    $beforeCursor: String
    $families: [AgentRuntimeEventFamily!]
    $limit: Int!
  ) {
    agentRuntimeEvents(
      agentId: $agentId
      beforeCursor: $beforeCursor
      families: $families
      limit: $limit
    ) {
      nodes {
        createdAt
        cursor
        eventType
        family
        id
        occurredAt
        sessionId
        source
        summary
        visibility
      }
      pageInfo {
        endCursor
        hasMore
        startCursor
      }
    }
  }
`);

export async function fetchAgentRuntimeEvents(input: {
  agentId: AgentId;
  beforeCursor?: string | null;
  families?: readonly AgentRuntimeEventFamily[] | null;
  limit?: number;
}): Promise<AgentRuntimeEventConnection> {
  const payload = await requestGraphQL(AGENT_RUNTIME_EVENTS_QUERY, {
    agentId: input.agentId,
    beforeCursor: input.beforeCursor ?? null,
    families: input.families === null || input.families === undefined ? null : [...input.families],
    limit: input.limit ?? 200,
  });

  return payload.agentRuntimeEvents;
}
