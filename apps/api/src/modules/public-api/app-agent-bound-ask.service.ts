/**
 * The blocking bound-agent ask endpoint (PM decision #2): a deployed App POSTs
 * the injected self-authorizing capability URL with `{ message | input }` and
 * gets the Agent's FINAL reply back in one call — no PAT.
 *
 * Flow: verify the capability token -> re-check the Agent is still published ->
 * resolve the App owner account and run as that owner (the App owns the Agent,
 * so we build the session from the owner viewer WITHOUT a PAT caller, reusing
 * `createAgentSession` + `queueSessionRun`) -> wait (bounded) for the run to
 * reach a terminal state -> return the final output text.
 */

import type { AgentId, AppId, SessionId, SessionRunId } from "@mosoo/id";

import { createErrorLogContext, logError } from "../../platform/cloudflare/logger";
import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import { getAgentRow } from "../agents/application/agent-repository";
import { getAppRow } from "../apps/application/app.service";
import { getAccountViewer } from "../auth/application/public-api-caller.service";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";
import { createAgentSession, queueSessionRun } from "../runtime/application/session-run.service";
import { getSessionRunSummary } from "../runtime/infrastructure/session-runs/session-run-store.repository";
import {
  ensureBoundAgentServable,
  selectBoundAgentReply,
  verifyBoundAgentCapability,
  waitForTerminalRun,
} from "./app-agent-bound-call";
import type { BoundAgentCallInput } from "./app-agent-bound-call";
import { publicNotFound } from "./public-api-errors";
import { readPublicThreadRunFinalOutput } from "./public-thread-events";
import { cleanupFailedThreadCreation } from "./public-thread-store";

const BOUND_AGENT_WAIT_TIMEOUT_MS = 25_000;
const BOUND_AGENT_WAIT_POLL_INTERVAL_MS = 1_000;

export interface CreateBoundAgentThreadAndWaitRequest {
  bindings: ApiBindings;
  executionContext: Pick<ExecutionContext, "waitUntil"> | null;
  input: BoundAgentCallInput;
  requestUrl: string;
  token: string;
}

export interface BoundAgentCallResponse {
  reply: string;
  runId: SessionRunId;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function resolveBoundAgentOwnerViewer(
  bindings: ApiBindings,
  appId: AppId,
): Promise<AuthenticatedViewer> {
  const app = await getAppRow(bindings.DB, appId);
  const ownerViewer = await getAccountViewer(bindings.DB, app.ownerAccountId);

  if (ownerViewer === null) {
    throw publicNotFound("App owner account was not found.");
  }

  return ownerViewer;
}

/**
 * Create the session and queue the run as the App owner. On failure before the
 * run is queued, the half-created session is cleaned up (mirrors the PAT thread
 * path). Once queued, the run is left in place for the wait + extraction.
 */
async function startBoundAgentRun(input: {
  agentId: AgentId;
  appId: AppId;
  bindings: ApiBindings;
  executionContext: Pick<ExecutionContext, "waitUntil"> | null;
  ownerViewer: AuthenticatedViewer;
  prompt: string;
  requestUrl: string;
}): Promise<{ runId: SessionRunId; sessionId: SessionId }> {
  let createdSessionId: SessionId | null = null;

  try {
    const session = await createAgentSession({
      bindings: input.bindings,
      executionContext: input.executionContext,
      input: {
        agentId: input.agentId,
        appId: input.appId,
        type: "ui",
      },
      options: {
        accessViewer: input.ownerViewer,
        attributedUserId: input.ownerViewer.id,
        metadata: null,
      },
      viewer: input.ownerViewer,
    });
    createdSessionId = session.id;

    const queued = await queueSessionRun({
      bindings: input.bindings,
      executionContext: input.executionContext,
      input: {
        accessViewer: input.ownerViewer,
        attachmentIds: [],
        clientRequestId: null,
        prompt: input.prompt,
        session: {
          agent_id: session.agentId,
          deployment_version_id: session.deploymentVersionId,
          deployment_version_number: session.deploymentVersionNumber,
          id: session.id,
          model: session.model,
          app_id: session.appId,
          provider: session.provider,
          runtime_id: session.runtimeId,
        },
      },
      requestUrl: input.requestUrl,
      viewer: input.ownerViewer,
    });

    return { runId: queued.run.id, sessionId: session.id };
  } catch (error) {
    if (createdSessionId !== null) {
      await cleanupFailedThreadCreation({
        bindings: input.bindings,
        fileIds: [],
        sessionId: createdSessionId,
      }).catch((cleanupError: unknown) => {
        logError("public-api.bound_agent_call.cleanup_failed", {
          ...createErrorLogContext(cleanupError),
          sessionId: createdSessionId,
        });
      });
    }

    throw error;
  }
}

export async function createBoundAgentThreadAndWait(
  request: CreateBoundAgentThreadAndWaitRequest,
): Promise<BoundAgentCallResponse> {
  const claims = await verifyBoundAgentCapability(
    request.bindings.RUNTIME_ACTION_TOKEN_SECRET,
    request.token,
    Date.now(),
  );

  const agent = await getAgentRow(request.bindings.DB, claims.agentId);
  ensureBoundAgentServable(agent, claims);

  const ownerViewer = await resolveBoundAgentOwnerViewer(request.bindings, agent.appId);

  const { runId, sessionId } = await startBoundAgentRun({
    agentId: agent.id,
    appId: agent.appId,
    bindings: request.bindings,
    executionContext: request.executionContext,
    ownerViewer,
    prompt: request.input.message,
    requestUrl: request.requestUrl,
  });

  const terminalRun = await waitForTerminalRun(
    {
      delay,
      now: () => Date.now(),
      readRun: () => getSessionRunSummary(request.bindings.DB, runId),
    },
    {
      pollIntervalMs: BOUND_AGENT_WAIT_POLL_INTERVAL_MS,
      timeoutMs: BOUND_AGENT_WAIT_TIMEOUT_MS,
    },
  );

  const finalOutput =
    terminalRun.status === "completed"
      ? await readPublicThreadRunFinalOutput({
          database: request.bindings.DB,
          runId,
          sessionId,
        })
      : null;

  const { reply } = selectBoundAgentReply({ finalOutput, run: terminalRun });

  return { reply, runId };
}
