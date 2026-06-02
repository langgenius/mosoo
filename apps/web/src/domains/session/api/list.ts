import type { OrganizationId } from "@mosoo/contracts/id";
import type {
  AgentSessionActionCapability,
  SessionSummary,
  SessionType,
} from "@mosoo/contracts/session";

import { graphql } from "@/gql";
import type { ThreadAgentSessionListQuery } from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";

import { toSessionSummary } from "./session-id-mappers";

export interface ThreadSessionListItem {
  capabilities: AgentSessionActionCapability[];
  session: SessionSummary;
}

const SESSIONS_QUERY = graphql(/* GraphQL */ `
  query Sessions($organizationId: ULID!, $archived: Boolean, $type: SessionType) {
    sessionList(organizationId: $organizationId, archived: $archived, type: $type) {
      nodes {
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
        runtimeId
        status
        title
        type
        updatedAt
        organizationId
      }
    }
  }
`);

const THREAD_AGENT_SESSION_LIST_QUERY = graphql(/* GraphQL */ `
  query ThreadAgentSessionList($organizationId: ULID!, $archived: Boolean, $type: SessionType) {
    threadAgentSessionList(organizationId: $organizationId, archived: $archived, type: $type) {
      nodes {
        capabilities {
          action
          reason
          status
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
          runtimeId
          status
          title
          type
          updatedAt
          organizationId
        }
      }
    }
  }
`);

async function fetchSessions(
  organizationId: OrganizationId,
  archived: boolean,
  type?: SessionType | null,
): Promise<SessionSummary[]> {
  const payload = await requestGraphQL(SESSIONS_QUERY, {
    archived,
    organizationId,
    type: type ?? null,
  });

  return payload.sessionList.nodes.map(toSessionSummary);
}

export async function sessions(
  organizationId: OrganizationId,
  type?: SessionType | null,
): Promise<SessionSummary[]> {
  return fetchSessions(organizationId, false, type);
}

function toThreadSessionListItem(
  node: ThreadAgentSessionListQuery["threadAgentSessionList"]["nodes"][number],
): ThreadSessionListItem {
  return {
    capabilities: node.capabilities,
    session: toSessionSummary(node.session),
  };
}

async function fetchThreadSessions(
  organizationId: OrganizationId,
  archived: boolean,
  type?: SessionType | null,
): Promise<ThreadSessionListItem[]> {
  const payload = await requestGraphQL(THREAD_AGENT_SESSION_LIST_QUERY, {
    archived,
    organizationId,
    type: type ?? null,
  });

  return payload.threadAgentSessionList.nodes.map(toThreadSessionListItem);
}

export async function threadSessions(
  organizationId: OrganizationId,
  type?: SessionType | null,
): Promise<ThreadSessionListItem[]> {
  return fetchThreadSessions(organizationId, false, type);
}

export async function archivedThreadSessions(
  organizationId: OrganizationId,
  type?: SessionType | null,
): Promise<ThreadSessionListItem[]> {
  return fetchThreadSessions(organizationId, true, type);
}
