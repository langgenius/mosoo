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
  query ThreadAgentSessionList(
    $appId: ULID!
    $archived: Boolean
    $beforeCursor: String
    $type: SessionType
  ) {
    threadAgentSessionList(
      appId: $appId
      archived: $archived
      beforeCursor: $beforeCursor
      type: $type
    ) {
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
      pageInfo {
        endCursor
        hasMore
      }
    }
  }
`);

interface ThreadSessionsPage {
  endCursor: string | null;
  hasMore: boolean;
  items: ThreadSessionListItem[];
}

function toThreadSessionListItem(
  node: ThreadAgentSessionListQuery["threadAgentSessionList"]["nodes"][number],
): ThreadSessionListItem {
  return {
    capabilities: node.capabilities,
    session: toSessionSummary(node.session),
  };
}

async function fetchThreadSessionsPage(
  appId: AppId,
  archived: boolean,
  beforeCursor: string | null,
  type?: SessionType | null,
): Promise<ThreadSessionsPage> {
  const payload = await requestGraphQL(THREAD_AGENT_SESSION_LIST_QUERY, {
    archived,
    appId,
    beforeCursor,
    type: type ?? null,
  });

  return {
    endCursor: payload.threadAgentSessionList.pageInfo.endCursor,
    hasMore: payload.threadAgentSessionList.pageInfo.hasMore,
    items: payload.threadAgentSessionList.nodes.map(toThreadSessionListItem),
  };
}

async function fetchAllThreadSessions(
  appId: AppId,
  archived: boolean,
  type?: SessionType | null,
): Promise<ThreadSessionListItem[]> {
  const items: ThreadSessionListItem[] = [];
  let beforeCursor: string | null = null;

  while (true) {
    const page = await fetchThreadSessionsPage(appId, archived, beforeCursor, type);
    items.push(...page.items);

    if (!page.hasMore) {
      return items;
    }

    if (page.endCursor === null || page.endCursor === beforeCursor) {
      throw new Error("Thread pagination did not provide a new cursor.");
    }

    beforeCursor = page.endCursor;
  }
}

export async function threadSessions(
  appId: AppId,
  type?: SessionType | null,
): Promise<ThreadSessionListItem[]> {
  return (await fetchThreadSessionsPage(appId, false, null, type)).items;
}

export async function archivedThreadSessions(
  appId: AppId,
  type?: SessionType | null,
): Promise<ThreadSessionListItem[]> {
  return (await fetchThreadSessionsPage(appId, true, null, type)).items;
}

export async function allThreadSessions(
  appId: AppId,
  type?: SessionType | null,
): Promise<ThreadSessionListItem[]> {
  const [activeSessions, archivedSessions] = await Promise.all([
    fetchAllThreadSessions(appId, false, type),
    fetchAllThreadSessions(appId, true, type),
  ]);

  return [...activeSessions, ...archivedSessions];
}
