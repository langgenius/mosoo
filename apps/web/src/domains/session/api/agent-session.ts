import type { AgentId, SessionId } from "@mosoo/contracts/id";
import type {
  AgentSessionEventInput,
  SessionMessage,
  SessionProcessEvent,
  SessionSummary,
  SessionType,
} from "@mosoo/contracts/session";

import { graphql } from "@/gql";
import type { ThreadSessionMessagesQuery } from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";

import { toSessionMessageId, toSessionSummary } from "./session-id-mappers";
import { SESSION_PROCESS_EVENT_QUERY_LIMIT, toSessionProcessEvent } from "./session-process-events";

const CREATE_AGENT_SESSION_MUTATION = graphql(/* GraphQL */ `
  mutation CreateAgentSession($input: CreateAgentSessionInput!) {
    createAgentSession(input: $input) {
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
`);

const AGENT_SESSION_LIST_QUERY = graphql(/* GraphQL */ `
  query AgentSessionList(
    $agentId: ULID!
    $archived: Boolean
    $participantOnly: Boolean
    $type: SessionType
  ) {
    agentSessionList(
      agentId: $agentId
      archived: $archived
      participantOnly: $participantOnly
      type: $type
    ) {
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

const AGENT_SESSION_PROCESS_EVENTS_QUERY = graphql(/* GraphQL */ `
  query AgentSessionProcessEvents($limit: Int!, $sessionId: ULID!) {
    sessionProcessEvents(limit: $limit, sessionId: $sessionId) {
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

const THREAD_SESSION_MESSAGES_QUERY = graphql(/* GraphQL */ `
  query ThreadSessionMessages($sessionId: ULID!) {
    threadSessionMessages(sessionId: $sessionId) {
      content
      createdAt
      createdBy
      id
      plan {
        content
        priority
        status
      }
      role
      segments {
        argsText
        kind
        output
        path
        text
        tool
        toolCallId
      }
    }
  }
`);

const SEND_AGENT_SESSION_EVENTS_MUTATION = graphql(/* GraphQL */ `
  mutation SendAgentSessionEvents($sessionId: ULID!, $events: [AgentSessionEventInput!]!) {
    sendAgentSessionEvents(sessionId: $sessionId, events: $events) {
      acceptedAt
      warnings {
        code
        message
      }
    }
  }
`);

const PREWARM_AGENT_SESSION_MUTATION = graphql(/* GraphQL */ `
  mutation PrewarmAgentSession($sessionId: ULID!) {
    prewarmAgentSession(sessionId: $sessionId) {
      scheduledAt
      sessionId
    }
  }
`);

const PREWARM_THROTTLE_MS = 30_000;
const lastPrewarmAtBySessionId = new Map<SessionId, number>();

/**
 * Fire-and-forget request that nudges the runtime prewarm pipeline for an
 * existing session. The viewer-socket entry already prewarms once on initial
 * connect, but Durable Object hibernation after a few minutes of idle clears
 * the warm driver state. Callers (e.g. the follow-up composer when the user
 * resumes typing) use this to warm the runtime before the next send.
 *
 * Throttled per-session so rapid keystrokes do not amplify into back-to-back
 * mutations. The server-side scheduler itself is idempotent (skips when an
 * active run is present and runs through `waitUntil` with best_effort failure
 * mode), so this throttle is only a network-side hygiene measure.
 *
 * Failures are swallowed on purpose — the worst case is a slightly slower next
 * message, which would have happened anyway without the prewarm.
 */
export function triggerAgentSessionPrewarm(sessionId: SessionId): void {
  const now = Date.now();
  const lastAt = lastPrewarmAtBySessionId.get(sessionId);
  if (lastAt !== undefined && now - lastAt < PREWARM_THROTTLE_MS) {
    return;
  }
  lastPrewarmAtBySessionId.set(sessionId, now);

  void requestGraphQL(PREWARM_AGENT_SESSION_MUTATION, { sessionId }).catch(() => {
    // Best-effort. Drop the throttle stamp on failure so a real retry path
    // (e.g. the next keystroke 30s later) can still fire.
    lastPrewarmAtBySessionId.delete(sessionId);
  });
}

function toSessionMessageSegment(
  segment: ThreadSessionMessagesQuery["threadSessionMessages"][number]["segments"][number],
): SessionMessage["segments"][number] {
  switch (segment.kind) {
    case "text": {
      return {
        kind: "text",
        text: segment.text ?? "",
      };
    }
    case "tool_use": {
      if (segment.tool === null || segment.tool === undefined) {
        throw new Error("Session message tool_use is missing tool.");
      }

      if (segment.toolCallId === null || segment.toolCallId === undefined) {
        throw new Error("Session message tool_use is missing toolCallId.");
      }

      return {
        argsText: segment.argsText ?? "",
        kind: "tool_use",
        path: segment.path,
        tool: segment.tool,
        toolCallId: segment.toolCallId,
      };
    }
    case "tool_result": {
      if (segment.output === null || segment.output === undefined) {
        throw new Error("Session message tool_result is missing output.");
      }

      if (segment.tool === null || segment.tool === undefined) {
        throw new Error("Session message tool_result is missing tool.");
      }

      if (segment.toolCallId === null || segment.toolCallId === undefined) {
        throw new Error("Session message tool_result is missing toolCallId.");
      }

      return {
        kind: "tool_result",
        output: segment.output,
        tool: segment.tool,
        toolCallId: segment.toolCallId,
      };
    }
    default: {
      throw new Error(`Unsupported session message segment kind: ${String(segment.kind)}`);
    }
  }
}

export async function createAgentSession(
  agentId: AgentId,
  type?: SessionType | null,
  options: {
    waitForRuntimeReady?: boolean;
  } = {},
): Promise<SessionSummary> {
  const waitForRuntimeReady = options.waitForRuntimeReady === true;
  const payload = await requestGraphQL(CREATE_AGENT_SESSION_MUTATION, {
    input: {
      agentId,
      type: type ?? null,
      ...(waitForRuntimeReady ? { waitForRuntimeReady } : {}),
    },
  });

  return toSessionSummary(payload.createAgentSession);
}

export async function listAgentSessions(
  agentId: AgentId,
  options: {
    archived?: boolean | null;
    participantOnly?: boolean | null;
    type?: SessionType | null;
  } = {},
): Promise<SessionSummary[]> {
  const payload = await requestGraphQL(AGENT_SESSION_LIST_QUERY, {
    agentId,
    archived: options.archived ?? null,
    participantOnly: options.participantOnly ?? null,
    type: options.type ?? null,
  });

  return payload.agentSessionList.nodes.map(toSessionSummary);
}

export async function getAgentSessionProcessEvents(
  sessionId: SessionId,
): Promise<SessionProcessEvent[]> {
  const payload = await requestGraphQL(AGENT_SESSION_PROCESS_EVENTS_QUERY, {
    limit: SESSION_PROCESS_EVENT_QUERY_LIMIT,
    sessionId,
  });

  return payload.sessionProcessEvents.map(toSessionProcessEvent);
}

export async function getThreadSessionMessages(sessionId: SessionId): Promise<SessionMessage[]> {
  const payload = await requestGraphQL(THREAD_SESSION_MESSAGES_QUERY, {
    sessionId,
  });

  return payload.threadSessionMessages.map(toClientSessionMessage);
}

function toClientSessionMessage(
  message: ThreadSessionMessagesQuery["threadSessionMessages"][number],
): SessionMessage {
  return {
    content: message.content,
    createdAt: message.createdAt,
    createdBy: message.createdBy,
    id: toSessionMessageId(message.id),
    plan: message.plan.map((entry) => ({
      content: entry.content,
      priority: entry.priority,
      status: entry.status,
    })),
    role: message.role,
    segments: message.segments.map(toSessionMessageSegment),
  } satisfies SessionMessage;
}

export async function sendAgentSessionEvents(input: {
  events: AgentSessionEventInput[];
  sessionId: SessionId;
}): Promise<void> {
  await requestGraphQL(SEND_AGENT_SESSION_EVENTS_MUTATION, {
    events: input.events,
    sessionId: input.sessionId,
  });
}
