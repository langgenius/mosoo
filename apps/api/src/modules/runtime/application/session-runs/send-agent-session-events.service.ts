import type {
  AgentSessionEventBatch,
  AgentSessionEventInput,
  AgentSessionEventResult,
  SessionSummary,
} from "@mosoo/contracts/session";
import type { UserWarning } from "@mosoo/contracts/session-run";
import { sessionsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, FileId, ProjectId, SessionId, SessionRunId } from "@mosoo/id";
import { getAvailableAgentSessionActionCapability } from "@mosoo/session-policy";
import { and, eq, isNull } from "drizzle-orm";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { currentTimestampMs, toIsoString } from "../../../../time";
import type { AuthenticatedViewer } from "../../../auth/application/viewer-auth.service";
import { appendSessionRuntimeEvents } from "../../../sessions/application/session-event-write.service";
import { getSessionSummaryById } from "../../../sessions/application/session-summary-query.service";
import { toSessionLifecycleStatusForRunStatus } from "../../../sessions/domain/session-lifecycle";
import { deriveSessionTitleFromPrompt } from "../../../sessions/domain/session-title";
import { getActiveSessionRunSummary } from "../../infrastructure/session-runs/session-run-store.repository";
import { cancelRun } from "./cancel-run.service";
import { queueSessionRun } from "./queue-run.service";
import type { QueuedSessionRunState } from "./queue-run.service";
import { resolveSessionPermissionDecision } from "./session-permission-decision.service";

interface SendAgentSessionEventsInput {
  events: AgentSessionEventInput[];
  projectId: string;
  sessionId: string;
}

interface AgentSessionEventsOptions {
  admissionRequestedAtMs?: number;
  accessViewer?: AuthenticatedViewer;
}

export interface SendAgentSessionEventsRequest {
  bindings: ApiBindings;
  executionContext: Pick<ExecutionContext, "waitUntil"> | null;
  input: SendAgentSessionEventsInput;
  options?: AgentSessionEventsOptions;
  requestUrl: string;
  viewer: AuthenticatedViewer;
}

function toActionCapabilityName(
  event: AgentSessionEventInput,
): "permission_decision" | "send_user_message" | "user_interrupt" {
  switch (event.type) {
    case "permission_decision": {
      return "permission_decision";
    }
    case "user_interrupt": {
      return "user_interrupt";
    }
    case "user_message": {
      return "send_user_message";
    }
    default: {
      throw new Error("Unsupported session event type.");
    }
  }
}

function parseNonEmptyText(value: string | null | undefined, label: string): string {
  const text = value?.trim();

  if (text === undefined || text.length === 0) {
    throw new Error(`${label} is required.`);
  }

  return text;
}

function parsePermissionDecision(value: unknown): "allow_once" | "reject_once" {
  if (value === "allow_once" || value === "reject_once") {
    return value;
  }

  throw new Error("Permission decision is required.");
}

async function getRunToInterrupt(
  database: D1Database,
  input: {
    runId: string | null | undefined;
    sessionId: SessionId;
  },
): Promise<SessionRunId> {
  if (input.runId !== null && input.runId !== undefined && input.runId.length > 0) {
    return parsePlatformId<SessionRunId>(input.runId, "run id");
  }

  const activeRun = await getActiveSessionRunSummary(database, input.sessionId);

  if (!activeRun) {
    throw new Error("No active session run to cancel.");
  }

  return activeRun.id;
}

export async function autoTitleSessionFromPrompt(input: {
  database: D1Database;
  sessionId: SessionId;
  text: string;
}): Promise<{ title: string; updatedAt: string } | null> {
  const timestampMs = currentTimestampMs();
  const title = deriveSessionTitleFromPrompt(input.text, { timestampMs });

  const row =
    (await getAppDatabase(input.database)
      .update(sessionsTable)
      .set({
        title,
        updatedAt: timestampMs,
      })
      .where(
        and(
          eq(sessionsTable.id, input.sessionId),
          isNull(sessionsTable.title),
          eq(sessionsTable.renamed, false),
        ),
      )
      .returning({
        title: sessionsTable.title,
        updatedAt: sessionsTable.updatedAt,
      })
      .get()) ?? null;

  return row === null
    ? null
    : {
        title: row.title ?? title,
        updatedAt: toIsoString(row.updatedAt),
      };
}

function applyHandledEventToSessionSummary(
  session: SessionSummary,
  handled: {
    result: AgentSessionEventResult;
    sessionState: QueuedSessionRunState | null;
    titleUpdate: { title: string; updatedAt: string } | null;
  },
): SessionSummary {
  const titledSession =
    handled.titleUpdate === null
      ? session
      : {
          ...session,
          title: handled.titleUpdate.title,
          updatedAt: handled.titleUpdate.updatedAt,
        };
  const run = handled.result.run;

  if (handled.sessionState !== null) {
    return {
      ...titledSession,
      lastMessageAt: handled.sessionState.lastMessageAt,
      lastRun: run,
      status: handled.sessionState.status,
      updatedAt: handled.sessionState.updatedAt,
    };
  }

  if (run !== null && titledSession.lastRun?.id === run.id) {
    return {
      ...titledSession,
      lastRun: run,
      status: toSessionLifecycleStatusForRunStatus(run.status),
      updatedAt: run.updatedAt,
    };
  }

  return titledSession;
}

async function handleAgentSessionEvent(input: {
  bindings: ApiBindings;
  event: AgentSessionEventInput;
  executionContext: Pick<ExecutionContext, "waitUntil"> | null;
  options: AgentSessionEventsOptions;
  requestUrl: string;
  session: SessionSummary;
  viewer: AuthenticatedViewer;
}): Promise<{
  result: AgentSessionEventResult;
  sessionState: QueuedSessionRunState | null;
  titleUpdate: { title: string; updatedAt: string } | null;
}> {
  const sessionId = input.session.id;

  switch (input.event.type) {
    case "user_message": {
      const text = parseNonEmptyText(input.event.text, "User message text");
      const queued = await queueSessionRun({
        bindings: input.bindings,
        executionContext: input.executionContext,
        input: {
          attachmentIds: (input.event.attachmentIds ?? []).map((value, index) =>
            parsePlatformId<FileId>(value, `attachment id ${index}`),
          ),
          clientRequestId: input.event.clientRequestId ?? null,
          prompt: text,
          session: input.session,
          ...(input.options.admissionRequestedAtMs === undefined
            ? {}
            : { admissionRequestedAtMs: input.options.admissionRequestedAtMs }),
          ...(input.options.accessViewer ? { accessViewer: input.options.accessViewer } : {}),
        },
        requestUrl: input.requestUrl,
        viewer: input.viewer,
      });
      const titleUpdate = await autoTitleSessionFromPrompt({
        database: input.bindings.DB,
        sessionId,
        text,
      });

      return {
        result: {
          clientRequestId: input.event.clientRequestId ?? null,
          run: queued.run,
          type: input.event.type,
        },
        sessionState: queued.sessionState,
        titleUpdate,
      };
    }

    case "permission_decision": {
      const requestId = parseNonEmptyText(input.event.requestId, "Permission request id");
      const decision = parsePermissionDecision(input.event.decision);
      const resolved = await resolveSessionPermissionDecision({
        bindings: input.bindings,
        decision,
        requestId,
        sessionId,
        viewer: input.viewer,
      });
      if (resolved) {
        await appendSessionRuntimeEvents({
          bindings: input.bindings,
          events: [resolved],
          sessionId,
        });
      }

      return {
        result: {
          clientRequestId: null,
          run: null,
          type: input.event.type,
        },
        sessionState: null,
        titleUpdate: null,
      };
    }

    case "user_interrupt": {
      const runId = await getRunToInterrupt(input.bindings.DB, {
        runId: input.event.runId,
        sessionId,
      });
      const cancelled = await cancelRun(input.bindings, input.viewer, { runId, sessionId });

      return {
        result: {
          clientRequestId: null,
          run: cancelled.run,
          type: input.event.type,
        },
        sessionState: null,
        titleUpdate: null,
      };
    }
    default: {
      throw new Error("Unsupported session event type.");
    }
  }
}

export async function sendAgentSessionEvents(
  request: SendAgentSessionEventsRequest,
): Promise<AgentSessionEventBatch> {
  const options = request.options ?? {};
  const sessionId = parsePlatformId<SessionId>(request.input.sessionId, "session id");
  const projectId = parsePlatformId<ProjectId>(request.input.projectId, "project id");
  const viewerId = parsePlatformId<AccountId>(request.viewer.id, "viewer id");

  if (request.input.events.length === 0) {
    throw new Error("At least one session event is required.");
  }

  const session = await getSessionSummaryById(request.bindings.DB, viewerId, {
    projectId,
    sessionId,
  });

  const results: AgentSessionEventResult[] = [];
  const warnings: UserWarning[] = [];
  const handledEvents: Awaited<ReturnType<typeof handleAgentSessionEvent>>[] = [];

  for (const event of request.input.events) {
    const capability = getAvailableAgentSessionActionCapability({
      action: toActionCapabilityName(event),
      archivedAt: session.archivedAt,
      runtimeId: session.runtimeId,
      status: session.status,
    });

    if (capability.status === "degraded") {
      warnings.push({
        code: `agent_session.${capability.action}.degraded`,
        message: capability.reason ?? `Agent Session action ${capability.action} is degraded.`,
      });
    }

    handledEvents.push(
      await handleAgentSessionEvent({
        bindings: request.bindings,
        event,
        executionContext: request.executionContext,
        options,
        requestUrl: request.requestUrl,
        session,
        viewer: request.viewer,
      }),
    );
  }

  let responseSession = session;

  for (const handled of handledEvents) {
    results.push(handled.result);
    responseSession = applyHandledEventToSessionSummary(responseSession, handled);
  }

  return {
    acceptedAt: new Date().toISOString(),
    events: results,
    session: responseSession,
    warnings,
  };
}
