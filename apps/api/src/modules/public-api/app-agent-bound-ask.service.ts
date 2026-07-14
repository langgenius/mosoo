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

import { createErrorLogContext, logError, logInfo } from "../../platform/cloudflare/logger";
import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import { getAgentRow } from "../agents/application/agent-repository";
import {
  createDeploymentAgentCapabilityRunCreationGuard,
  getDeploymentAgentCapabilityAuthority,
} from "../apps/application/app-deployment-capability-authority.service";
import type { DeploymentAgentCapabilityAuthorityRejection } from "../apps/application/app-deployment-capability-authority.service";
import { getAppRow } from "../apps/application/app.service";
import { getAccountViewer } from "../auth/application/public-api-caller.service";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";
import {
  createAgentSession,
  queueSessionRun,
  SessionRunCreationGuardRejectedError,
} from "../runtime/application/session-run.service";
import { getSessionRunSummary } from "../runtime/infrastructure/session-runs/session-run-store.repository";
import {
  getBoundAgentServabilityFailure,
  inspectBoundAgentCapability,
  selectBoundAgentReply,
  waitForTerminalRun,
} from "./app-agent-bound-call";
import type { BoundAgentServabilityFailure } from "./app-agent-bound-call";
import type { BoundAgentCallInput } from "./app-agent-bound-call";
import type { AppAgentCapabilityClaims } from "./app-agent-capability";
import { publicAgentNotExposed, publicNotFound, publicUnauthenticated } from "./public-api-errors";
import { enforcePublicApiRateLimit } from "./public-api-rate-limit.service";
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

type BoundAgentCapabilityRejectionReason =
  | BoundAgentServabilityFailure
  | DeploymentAgentCapabilityAuthorityRejection
  | "expired";

function logBoundAgentCapabilityRejection(
  claims: AppAgentCapabilityClaims,
  reason: BoundAgentCapabilityRejectionReason,
): void {
  logInfo("public-api.bound_agent_capability.rejected", {
    agentId: claims.agentId,
    appId: claims.appId,
    bindingEnv: claims.binding.env,
    bindingName: claims.binding.name,
    deploymentId: claims.deploymentId,
    deploymentRunId: claims.deploymentRunId,
    reason,
  });
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
  capability: AppAgentCapabilityClaims;
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
        runCreationGuard: createDeploymentAgentCapabilityRunCreationGuard(input.capability),
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
  const verification = await inspectBoundAgentCapability(
    request.bindings.RUNTIME_ACTION_TOKEN_SECRET,
    request.token,
    Date.now(),
  );

  if (verification.status !== "valid") {
    if (verification.status === "expired") {
      logBoundAgentCapabilityRejection(verification.claims, "expired");
    }

    throw publicUnauthenticated("The capability URL is invalid or has expired.");
  }

  const claims = verification.claims;

  const agent = await getAgentRow(request.bindings.DB, claims.agentId);
  const agentFailure = getBoundAgentServabilityFailure(agent, claims);

  if (agentFailure !== null) {
    logBoundAgentCapabilityRejection(claims, agentFailure);
    throw publicAgentNotExposed("This Agent is no longer published for bound calls.");
  }

  const authority = await getDeploymentAgentCapabilityAuthority(request.bindings.DB, claims);

  if (!authority.authorized) {
    logBoundAgentCapabilityRejection(claims, authority.reason);
    throw publicAgentNotExposed(
      "This capability is no longer authorized for the active deployment.",
    );
  }

  // The capability URL is keyless, long-lived, and internet-facing: without a
  // limit a single leaked URL could launch unbounded owner-billed runs. Reuse
  // the shared public-API limiter keyed on the capability identity, in a
  // dedicated `bound:` bucket namespace so it never collides with PAT tokenIds.
  await enforcePublicApiRateLimit(request.bindings.DB, `bound:${agent.appId}:${agent.id}`);

  const ownerViewer = await resolveBoundAgentOwnerViewer(request.bindings, agent.appId);

  let startedRun: { runId: SessionRunId; sessionId: SessionId };

  try {
    startedRun = await startBoundAgentRun({
      agentId: agent.id,
      appId: agent.appId,
      bindings: request.bindings,
      capability: claims,
      executionContext: request.executionContext,
      ownerViewer,
      prompt: request.input.message,
      requestUrl: request.requestUrl,
    });
  } catch (error) {
    if (!(error instanceof SessionRunCreationGuardRejectedError)) {
      throw error;
    }

    const currentAgent = await getAgentRow(request.bindings.DB, claims.agentId);
    const currentAgentFailure = getBoundAgentServabilityFailure(currentAgent, claims);

    if (currentAgentFailure !== null) {
      logBoundAgentCapabilityRejection(claims, currentAgentFailure);
      throw publicAgentNotExposed("This Agent is no longer published for bound calls.");
    }

    const currentAuthority = await getDeploymentAgentCapabilityAuthority(
      request.bindings.DB,
      claims,
    );

    if (!currentAuthority.authorized) {
      logBoundAgentCapabilityRejection(claims, currentAuthority.reason);
      throw publicAgentNotExposed(
        "This capability is no longer authorized for the active deployment.",
      );
    }

    throw error;
  }

  const { runId, sessionId } = startedRun;

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
