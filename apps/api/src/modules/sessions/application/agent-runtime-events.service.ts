import type {
  SessionRuntimeEventFamily,
  SessionRuntimeEventSource,
  SessionRuntimeEventVisibility,
} from "@mosoo/contracts/session";
import { sessionEventsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { AgentId, RuntimeEventId, SessionId } from "@mosoo/id";
import type { SQL } from "drizzle-orm";
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { API_ERROR_CODE, validationError } from "../../../platform/errors";
import { toIsoString } from "../../../time";
import { ensureAgentRuntimeLogAccess } from "../../agents/application/agent-access.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";

export type AgentRuntimeEventFamily = SessionRuntimeEventFamily;
export type AgentRuntimeEventSource = SessionRuntimeEventSource;
export type AgentRuntimeEventVisibility = SessionRuntimeEventVisibility;

export interface AgentRuntimeEventNode {
  createdAt: string;
  cursor: string;
  eventType: string;
  family: AgentRuntimeEventFamily;
  id: RuntimeEventId;
  occurredAt: string;
  sessionId: SessionId;
  source: AgentRuntimeEventSource;
  summary: string;
  visibility: AgentRuntimeEventVisibility;
}

export interface AgentRuntimeEventConnection {
  nodes: AgentRuntimeEventNode[];
  pageInfo: {
    endCursor: string | null;
    hasMore: boolean;
    startCursor: string | null;
  };
}

interface AgentRuntimeEventRow {
  created_at: number;
  event_type: string;
  family: AgentRuntimeEventFamily;
  id: RuntimeEventId;
  occurred_at: number;
  session_id: SessionId;
  source: AgentRuntimeEventSource;
  summary: string;
  visibility: AgentRuntimeEventVisibility;
}

interface AgentRuntimeEventCursor {
  createdAt: number;
  id: RuntimeEventId;
}

const DEFAULT_AGENT_RUNTIME_EVENT_LIMIT = 200;
const MAX_AGENT_RUNTIME_EVENT_LIMIT = 500;

const agentRuntimeEventRowSelection = {
  created_at: sessionEventsTable.createdAt,
  event_type: sessionEventsTable.eventType,
  family: sessionEventsTable.family,
  id: sessionEventsTable.id,
  occurred_at: sessionEventsTable.occurredAt,
  session_id: sessionEventsTable.sessionId,
  source: sessionEventsTable.source,
  summary: sessionEventsTable.contentText,
  visibility: sessionEventsTable.visibility,
};

function normalizeAgentRuntimeEventLimit(limit: number | null | undefined): number {
  if (limit === null || limit === undefined) {
    return DEFAULT_AGENT_RUNTIME_EVENT_LIMIT;
  }

  if (!Number.isInteger(limit) || limit < 1) {
    throw validationError(
      "Agent runtime event limit must be a positive integer.",
      API_ERROR_CODE.runtimeEventLimitInvalid,
    );
  }

  return Math.min(limit, MAX_AGENT_RUNTIME_EVENT_LIMIT);
}

function encodeAgentRuntimeEventCursor(row: { created_at: number; id: string }): string {
  return `${row.created_at}:${row.id}`;
}

function parseAgentRuntimeEventCursor(
  cursor: string | null | undefined,
): AgentRuntimeEventCursor | null {
  if (cursor === null || cursor === undefined || cursor.trim() === "") {
    return null;
  }

  const delimiterIndex = cursor.indexOf(":");
  if (delimiterIndex <= 0 || delimiterIndex === cursor.length - 1) {
    throw validationError(
      "Agent runtime event cursor is invalid.",
      API_ERROR_CODE.runtimeEventCursorInvalid,
    );
  }

  const createdAt = Number(cursor.slice(0, delimiterIndex));
  const id = cursor.slice(delimiterIndex + 1);

  if (!Number.isInteger(createdAt) || createdAt < 0 || id.trim() === "") {
    throw validationError(
      "Agent runtime event cursor is invalid.",
      API_ERROR_CODE.runtimeEventCursorInvalid,
    );
  }

  return { createdAt, id: parsePlatformId<RuntimeEventId>(id, "Agent runtime event cursor ID") };
}

function toAgentRuntimeEventNode(row: AgentRuntimeEventRow): AgentRuntimeEventNode {
  return {
    createdAt: toIsoString(row.created_at),
    cursor: encodeAgentRuntimeEventCursor(row),
    eventType: row.event_type,
    family: row.family,
    id: row.id,
    occurredAt: toIsoString(row.occurred_at),
    sessionId: row.session_id,
    source: row.source,
    summary: row.summary,
    visibility: row.visibility,
  };
}

function canReadOwnerDebugEvents(viewerRole: "admin" | "owner" | "user"): boolean {
  return viewerRole === "owner" || viewerRole === "admin";
}

function buildAgentRuntimeEventFilters(input: {
  agentId: AgentId;
  beforeCursor?: AgentRuntimeEventCursor | null;
  families?: readonly AgentRuntimeEventFamily[] | null;
  viewerRole: "admin" | "owner" | "user";
}): SQL[] {
  const filters: SQL[] = [eq(sessionEventsTable.agentId, input.agentId)];

  if (input.beforeCursor) {
    filters.push(
      or(
        lt(sessionEventsTable.createdAt, input.beforeCursor.createdAt),
        and(
          eq(sessionEventsTable.createdAt, input.beforeCursor.createdAt),
          lt(sessionEventsTable.id, input.beforeCursor.id),
        ),
      )!,
    );
  }

  if (!canReadOwnerDebugEvents(input.viewerRole)) {
    filters.push(eq(sessionEventsTable.visibility, "all_consumers"));
  }

  if (input.families !== null && input.families !== undefined) {
    filters.push(inArray(sessionEventsTable.family, [...input.families]));
  }

  return filters;
}

async function listAgentRuntimeEventRows(input: {
  agentId: AgentId;
  beforeCursor?: AgentRuntimeEventCursor | null;
  database: D1Database;
  families?: readonly AgentRuntimeEventFamily[] | null;
  limit: number;
  viewerRole: "admin" | "owner" | "user";
}): Promise<AgentRuntimeEventRow[]> {
  return getAppDatabase(input.database)
    .select(agentRuntimeEventRowSelection)
    .from(sessionEventsTable)
    .where(
      and(
        ...buildAgentRuntimeEventFilters({
          agentId: input.agentId,
          ...(input.beforeCursor === undefined ? {} : { beforeCursor: input.beforeCursor }),
          ...(input.families === undefined ? {} : { families: input.families }),
          viewerRole: input.viewerRole,
        }),
      ),
    )
    .orderBy(desc(sessionEventsTable.createdAt), desc(sessionEventsTable.id))
    .limit(input.limit)
    .all();
}

async function listVisibleAgentRuntimeEventNodes(input: {
  agentId: AgentId;
  beforeCursor: AgentRuntimeEventCursor | null;
  database: D1Database;
  families: readonly AgentRuntimeEventFamily[] | null;
  limit: number;
  viewerRole: "admin" | "owner" | "user";
}): Promise<{
  endCursor: string | null;
  hasMore: boolean;
  nodes: AgentRuntimeEventNode[];
}> {
  if (input.families !== null && input.families.length === 0) {
    return { endCursor: null, hasMore: false, nodes: [] };
  }

  const rows = await listAgentRuntimeEventRows({
    agentId: input.agentId,
    beforeCursor: input.beforeCursor,
    database: input.database,
    families: input.families,
    limit: input.limit + 1,
    viewerRole: input.viewerRole,
  });
  const nodes = rows.slice(0, input.limit).map(toAgentRuntimeEventNode);

  return {
    endCursor: nodes.at(-1)?.cursor ?? null,
    hasMore: rows.length > input.limit,
    nodes,
  };
}

export async function getAgentRuntimeEvents(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: {
    agentId: AgentId;
    beforeCursor?: string | null;
    families?: readonly AgentRuntimeEventFamily[] | null;
    limit?: number | null;
  },
): Promise<AgentRuntimeEventConnection> {
  const limit = normalizeAgentRuntimeEventLimit(input.limit);
  const beforeCursor = parseAgentRuntimeEventCursor(input.beforeCursor);
  const access = await ensureAgentRuntimeLogAccess(database, viewer.id, input.agentId);
  const page = await listVisibleAgentRuntimeEventNodes({
    agentId: input.agentId,
    beforeCursor,
    database,
    families: input.families ?? null,
    limit,
    viewerRole: access.viewerRole,
  });

  return {
    nodes: page.nodes,
    pageInfo: {
      endCursor: page.endCursor,
      hasMore: page.hasMore,
      startCursor: page.nodes[0]?.cursor ?? null,
    },
  };
}
