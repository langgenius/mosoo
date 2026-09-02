import type { ProjectId } from "@mosoo/contracts/id";
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
    $projectId: ULID!
    $archived: Boolean
    $beforeCursor: String
    $type: SessionType
  ) {
    threadAgentSessionList(
      projectId: $projectId
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
          projectId
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
  projectId: ProjectId,
  archived: boolean,
  beforeCursor: string | null,
  type?: SessionType | null,
): Promise<ThreadSessionsPage> {
  const payload = await requestGraphQL(THREAD_AGENT_SESSION_LIST_QUERY, {
    archived,
    projectId,
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
  projectId: ProjectId,
  archived: boolean,
  type?: SessionType | null,
): Promise<ThreadSessionListItem[]> {
  const items: ThreadSessionListItem[] = [];
  let beforeCursor: string | null = null;

  while (true) {
    const page = await fetchThreadSessionsPage(projectId, archived, beforeCursor, type);
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
  projectId: ProjectId,
  type?: SessionType | null,
): Promise<ThreadSessionListItem[]> {
  return (await fetchThreadSessionsPage(projectId, false, null, type)).items;
}

export async function archivedThreadSessions(
  projectId: ProjectId,
  type?: SessionType | null,
): Promise<ThreadSessionListItem[]> {
  return (await fetchThreadSessionsPage(projectId, true, null, type)).items;
}

export async function allThreadSessions(
  projectId: ProjectId,
  type?: SessionType | null,
): Promise<ThreadSessionListItem[]> {
  const [activeSessions, archivedSessions] = await Promise.all([
    fetchAllThreadSessions(projectId, false, type),
    fetchAllThreadSessions(projectId, true, type),
  ]);

  return [...activeSessions, ...archivedSessions];
}
