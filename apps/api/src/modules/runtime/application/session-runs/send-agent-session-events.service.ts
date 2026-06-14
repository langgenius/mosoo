import type { SessionLiveState } from "@mosoo/ag-ui-session";
import type {
  AgentSessionEventBatch,
  AgentSessionEventInput,
  AgentSessionEventResult,
  SessionSummary,
} from "@mosoo/contracts/session";
import type { UserWarning } from "@mosoo/contracts/session-run";
import { sessionsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, FileId, AppId, SessionId, SessionRunId } from "@mosoo/id";
import { getAvailableAgentSessionActionCapability } from "@mosoo/session-policy";
import { and, eq, isNull } from "drizzle-orm";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { runOrderedAsyncTasks } from "../../../../shared/ordered-async";
import { currentTimestampMs, toIsoString } from "../../../../time";
import type { AuthenticatedViewer } from "../../../auth/application/viewer-auth.service";
import { appendSessionRuntimeEvents } from "../../../sessions/application/session-event-write.service";
import { getParticipantSessionSummaryAccessById } from "../../../sessions/application/session-query.service";
import type { SessionActionAuthorization } from "../../../sessions/domain/session-access.policy";
import { resolveSessionActionCreatorFlag } from "../../../sessions/domain/session-access.policy";
import { toSessionLifecycleStatusForRunStatus } from "../../../sessions/domain/session-lifecycle";
import { deriveSessionTitleFromPrompt } from "../../../sessions/domain/session-title";
import { getActiveSessionRunId } from "../../infrastructure/session-runs/session-run-store.repository";
import { cancelRun } from "./cancel-run.service";
import type { QueuedSessionRunState } from "./queue-run.service";
import { resolveSessionPermissionDecision } from "./session-permission-decision.service";
import { startRuns } from "./start-runs.service";

interface SendAgentSessionEventsInput {
  events: AgentSessionEventInput[];
  appId: string;
  sessionId: string;
}

interface AgentSessionEventsOptions {
  accessViewer?: AuthenticatedViewer;
  actionAuthorization?: SessionActionAuthorization;
  cachedState?: SessionLiveState | null;
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

function parseAttachmentIds(values: readonly string[] | null | undefined): FileId[] {
  return (values ?? []).map((value, index) =>
    parsePlatformId<FileId>(value, `attachment id ${index}`),
  );
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

  const activeRunId = await getActiveSessionRunId(database, input.sessionId);

  if (!activeRunId) {
    throw new Error("No active session run to cancel.");
  }

  return activeRunId;
}

async function autoTitleSessionFromPrompt(input: {
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
  appId: AppId;
  sessionId: SessionId;
  viewer: AuthenticatedViewer;
}): Promise<{
  result: AgentSessionEventResult;
  sessionState: QueuedSessionRunState | null;
  titleUpdate: { title: string; updatedAt: string } | null;
  warnings: UserWarning[];
}> {
  switch (input.event.type) {
    case "user_message": {
      const text = parseNonEmptyText(input.event.text, "User message text");
      const titleUpdate = await autoTitleSessionFromPrompt({
        database: input.bindings.DB,
        sessionId: input.sessionId,
        text,
      });
      const started = await startRuns({
        bindings: input.bindings,
        executionContext: input.executionContext,
        input: {
          requests: [
            {
              attachmentIds: parseAttachmentIds(input.event.attachmentIds),
              prompt: {
                content: text,
              },
              appId: input.appId,
              sessionId: input.sessionId,
              ...(input.event.clientRequestId !== null && input.event.clientRequestId !== undefined
                ? { clientRequestId: input.event.clientRequestId }
                : {}),
            },
          ],
        },
        options: input.options,
        requestUrl: input.requestUrl,
        viewer: input.viewer,
      });

      return {
        result: {
          clientRequestId: input.event.clientRequestId ?? null,
          run: started.runs[0] ?? null,
          type: input.event.type,
        },
        sessionState: started.sessionStates[0] ?? null,
        titleUpdate,
        warnings: started.warnings,
      };
    }

    case "permission_decision": {
      const requestId = parseNonEmptyText(input.event.requestId, "Permission request id");
      const decision = parsePermissionDecision(input.event.decision);
      const updated = await resolveSessionPermissionDecision({
        bindings: input.bindings,
        cachedState: input.options.cachedState ?? null,
        decision,
        requestId,
        appId: input.appId,
        sessionId: input.sessionId,
        viewer: input.viewer,
      });
      if (updated) {
        await appendSessionRuntimeEvents({
          bindings: input.bindings,
          events: [updated.event],
          sessionId: input.sessionId,
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
        warnings: [],
      };
    }

    case "user_interrupt": {
      const runId = await getRunToInterrupt(input.bindings.DB, {
        runId: input.event.runId,
        sessionId: input.sessionId,
      });
      const cancelled = await cancelRun(input.bindings, input.viewer, {
        appId: input.appId,
        runId,
        sessionId: input.sessionId,
      });

      return {
        result: {
          clientRequestId: null,
          run: cancelled.run,
          type: input.event.type,
        },
        sessionState: null,
        titleUpdate: null,
        warnings: [],
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
  const appId = parsePlatformId<AppId>(request.input.appId, "app id");
  const viewerId = parsePlatformId<AccountId>(request.viewer.id, "viewer id");

  if (request.input.events.length === 0) {
    throw new Error("At least one session event is required.");
  }

  const access = await getParticipantSessionSummaryAccessById(request.bindings.DB, viewerId, {
    appId,
    sessionId,
  });
  const session = access.session;
  const isSessionCreator = resolveSessionActionCreatorFlag({
    authorization: options.actionAuthorization,
    isSessionCreator: access.isSessionCreator,
  });

  const results: AgentSessionEventResult[] = [];
  const warnings: UserWarning[] = [];

  const handledEvents = await runOrderedAsyncTasks(
    request.input.events.map((event) => async () => {
      const capability = getAvailableAgentSessionActionCapability({
        action: toActionCapabilityName(event),
        archivedAt: session.archivedAt,
        isSessionCreator,
        runtimeId: session.runtimeId,
        status: session.status,
      });

      if (capability.status === "degraded") {
        warnings.push({
          code: `agent_session.${capability.action}.degraded`,
          message: capability.reason ?? `Agent Session action ${capability.action} is degraded.`,
        });
      }

      return handleAgentSessionEvent({
        bindings: request.bindings,
        event,
        executionContext: request.executionContext,
        options,
        appId,
        requestUrl: request.requestUrl,
        sessionId,
        viewer: request.viewer,
      });
    }),
  );

  let responseSession = session;

  for (const handled of handledEvents) {
    results.push(handled.result);
    warnings.push(...handled.warnings);
    responseSession = applyHandledEventToSessionSummary(responseSession, handled);
  }

  return {
    acceptedAt: new Date().toISOString(),
    events: results,
    session: responseSession,
    warnings,
  };
}
