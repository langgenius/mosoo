import { PUBLIC_API_PREFIX } from "@mosoo/contracts/public-api";
import type {
  AgentRunWorkflow,
  SessionSummary,
  StartAgentRunInput,
} from "@mosoo/contracts/session";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, AgentId, AppId, SessionId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { validationError } from "../../../platform/errors";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  createAgentSession,
  sendAgentSessionEvents,
} from "../../runtime/application/session-run.service";
import { getParticipantSessionSummaryAccessById } from "./session-query.service";

const PROCESS_EVENTS_OPERATION = "threadSessionProcessEvents";
const MESSAGES_OPERATION = "threadSessionMessages";
const RETRIEVE_OPERATION = "threadAgentSessionRetrieve";
const DEFAULT_POLL_INTERVAL_MS = 1000;

export interface StartAgentRunRequest {
  bindings: ApiBindings;
  executionContext: Pick<ExecutionContext, "waitUntil"> | null;
  input: StartAgentRunInput;
  requestUrl: string;
  viewer: AuthenticatedViewer;
}

function parsePrompt(value: string): string {
  const prompt = value.trim();

  if (prompt.length === 0) {
    throw validationError("Prompt is required.");
  }

  return prompt;
}

function toGraphQLUrl(requestUrl: string): string {
  const url = new URL(requestUrl);
  url.pathname = `${PUBLIC_API_PREFIX}/graphql`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function getExistingRunSession(input: {
  agentId: AgentId | null;
  appId: AppId;
  bindings: ApiBindings;
  sessionId: SessionId;
  viewer: AuthenticatedViewer;
}): Promise<SessionSummary> {
  const viewerId = parsePlatformId<AccountId>(input.viewer.id, "viewer id");
  const access = await getParticipantSessionSummaryAccessById(input.bindings.DB, viewerId, {
    appId: input.appId,
    sessionId: input.sessionId,
  });

  if (input.agentId !== null && access.session.agentId !== input.agentId) {
    throw validationError("Session does not belong to the requested Agent.");
  }

  return access.session;
}

type RunSessionInput =
  | {
      agentId: AgentId;
      appId: AppId;
      sessionId: null;
    }
  | {
      agentId: AgentId | null;
      appId: AppId;
      sessionId: SessionId;
    };

function getRunSessionInput(input: StartAgentRunInput): RunSessionInput {
  const appId = parsePlatformId<AppId>(input.appId, "app id");
  const sessionId =
    input.sessionId === null || input.sessionId === undefined
      ? null
      : parsePlatformId<SessionId>(input.sessionId, "session id");
  const agentId =
    input.agentId === null || input.agentId === undefined
      ? null
      : parsePlatformId<AgentId>(input.agentId, "agent id");

  if (sessionId === null) {
    if (agentId === null) {
      throw validationError("Agent id is required when starting a new run without a session.");
    }

    return {
      agentId,
      appId,
      sessionId,
    };
  }

  return {
    agentId,
    appId,
    sessionId,
  };
}

export async function startAgentRun(request: StartAgentRunRequest): Promise<AgentRunWorkflow> {
  const ids = getRunSessionInput(request.input);
  const prompt = parsePrompt(request.input.prompt);
  let createdSession = false;
  let session: SessionSummary;

  if (ids.sessionId === null) {
    session = await createAgentSession({
      bindings: request.bindings,
      executionContext: request.executionContext,
      input: {
        agentId: ids.agentId,
        appId: ids.appId,
        type: request.input.type ?? "ui",
        waitForRuntimeReady: request.input.waitForRuntimeReady ?? null,
      },
      ...(request.input.waitForRuntimeReady === true ? { requestUrl: request.requestUrl } : {}),
      viewer: request.viewer,
    });
    createdSession = true;
  } else {
    session = await getExistingRunSession({
      agentId: ids.agentId,
      appId: ids.appId,
      bindings: request.bindings,
      sessionId: ids.sessionId,
      viewer: request.viewer,
    });
  }

  const eventBatch = await sendAgentSessionEvents({
    bindings: request.bindings,
    executionContext: request.executionContext,
    input: {
      events: [
        {
          ...(request.input.clientRequestId !== null && request.input.clientRequestId !== undefined
            ? { clientRequestId: request.input.clientRequestId }
            : {}),
          text: prompt,
          type: "user_message",
        },
      ],
      appId: session.appId,
      sessionId: session.id,
    },
    requestUrl: request.requestUrl,
    viewer: request.viewer,
  });
  const run = eventBatch.events.find((event) => event.run !== null)?.run ?? null;

  return {
    acceptedAt: eventBatch.acceptedAt,
    createdSession,
    eventBatch,
    eventSurface: {
      appId: session.appId,
      graphqlUrl: toGraphQLUrl(request.requestUrl),
      messagesOperation: MESSAGES_OPERATION,
      processEventsOperation: PROCESS_EVENTS_OPERATION,
      retrieveOperation: RETRIEVE_OPERATION,
      sessionId: session.id,
      streamUrl: null,
      suggestedPollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    },
    run,
    session: eventBatch.session,
  };
}
