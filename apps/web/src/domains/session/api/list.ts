import type { AppId } from "@mosoo/contracts/id";
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

const THREAD_AGENT_SESSION_LIST_QUERY = graphql(/* GraphQL */ `
  query ThreadAgentSessionList($appId: ULID!, $archived: Boolean, $type: SessionType) {
    threadAgentSessionList(appId: $appId, archived: $archived, type: $type) {
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
          appId
          runtimeId
          status
          title
          type
          updatedAt
        }
      }
    }
  }
`);

function toThreadSessionListItem(
  node: ThreadAgentSessionListQuery["threadAgentSessionList"]["nodes"][number],
): ThreadSessionListItem {
  return {
    capabilities: node.capabilities,
    session: toSessionSummary(node.session),
  };
}

async function fetchThreadSessions(
  appId: AppId,
  archived: boolean,
  type?: SessionType | null,
): Promise<ThreadSessionListItem[]> {
  const payload = await requestGraphQL(THREAD_AGENT_SESSION_LIST_QUERY, {
    archived,
    appId,
    type: type ?? null,
  });

  return payload.threadAgentSessionList.nodes.map(toThreadSessionListItem);
}

export async function threadSessions(
  appId: AppId,
  type?: SessionType | null,
): Promise<ThreadSessionListItem[]> {
  return fetchThreadSessions(appId, false, type);
}

export async function archivedThreadSessions(
  appId: AppId,
  type?: SessionType | null,
): Promise<ThreadSessionListItem[]> {
  return fetchThreadSessions(appId, true, type);
}
