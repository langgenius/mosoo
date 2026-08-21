/**
 * Admission for the deployment-scoped runtime identity a deployed App receives
 * through its injected bound Agent capability URL.
 *
 * Every bound request — the blocking ask and the Public Thread / file routes
 * mounted under the same URL — passes through `admitDeploymentCapability`
 * first: verify the signed token, re-check that the Agent is still published
 * for the App, re-check that the Deployment revision still carries the binding,
 * and resolve the App owner the capability acts on behalf of. The result is a
 * `PublicApiCaller` whose thread and file admission is narrowed to the App,
 * Agent binding, and Deployment named by the claims; the owner's account-wide
 * Access Token never reaches deployed code.
 */

import { logInfo } from "../../platform/cloudflare/logger";
import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import { getAgentRow } from "../agents/application/agent-repository";
import type { AgentRow } from "../agents/application/agent-types";
import {
  createDeploymentAgentCapabilityRunCreationGuard,
  getDeploymentAgentCapabilityAuthority,
} from "../apps/application/app-deployment-capability-authority.service";
import type { DeploymentAgentCapabilityAuthorityRejection } from "../apps/application/app-deployment-capability-authority.service";
import { getAppRow } from "../apps/application/app.service";
import {
  getAccountViewer,
  toDeploymentCapabilityCredentialSubjectId,
} from "../auth/application/public-api-caller.service";
import type { DeploymentCapabilityPublicApiCaller } from "../auth/application/public-api-caller.service";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";
import type { BoundCapabilityRunAdmission } from "../runtime/domain/bound-capability-run-provenance";
import {
  getBoundAgentServabilityFailure,
  inspectBoundAgentCapability,
} from "./app-agent-bound-call";
import type { BoundAgentServabilityFailure } from "./app-agent-bound-call";
import type { AppAgentCapabilityClaims } from "./app-agent-capability";
import { publicAgentNotExposed, publicNotFound, publicUnauthenticated } from "./public-api-errors";

export interface DeploymentCapabilityAdmission {
  agent: AgentRow;
  claims: AppAgentCapabilityClaims;
  ownerViewer: AuthenticatedViewer;
}

export type DeploymentCapabilityRejectionReason =
  | BoundAgentServabilityFailure
  | DeploymentAgentCapabilityAuthorityRejection
  | "expired";

export const DEPLOYMENT_CAPABILITY_INVALID_MESSAGE =
  "The capability URL is invalid or has expired.";
export const DEPLOYMENT_CAPABILITY_AGENT_UNPUBLISHED_MESSAGE =
  "This Agent is no longer published for bound calls.";
export const DEPLOYMENT_CAPABILITY_REVOKED_MESSAGE =
  "This capability is no longer authorized for the active deployment.";

export function logDeploymentCapabilityRejection(
  claims: AppAgentCapabilityClaims,
  reason: DeploymentCapabilityRejectionReason,
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

/**
 * Re-run the revocable checks (Agent still published for the App, Deployment
 * revision still carries the binding) without re-verifying the signature.
 * Used both on entry and after a guarded Run insert is rejected, so the
 * rejection reason reflects the current D1 state.
 */
export async function ensureDeploymentCapabilityAuthorized(
  database: D1Database,
  claims: AppAgentCapabilityClaims,
): Promise<AgentRow> {
  const agent = await getAgentRow(database, claims.agentId);
  const agentFailure = getBoundAgentServabilityFailure(agent, claims);

  if (agentFailure !== null) {
    logDeploymentCapabilityRejection(claims, agentFailure);
    throw publicAgentNotExposed(DEPLOYMENT_CAPABILITY_AGENT_UNPUBLISHED_MESSAGE);
  }

  const authority = await getDeploymentAgentCapabilityAuthority(database, claims);

  if (!authority.authorized) {
    logDeploymentCapabilityRejection(claims, authority.reason);
    throw publicAgentNotExposed(DEPLOYMENT_CAPABILITY_REVOKED_MESSAGE);
  }

  return agent;
}

export async function admitDeploymentCapability(
  bindings: ApiBindings,
  token: string,
  nowMs: number,
): Promise<DeploymentCapabilityAdmission> {
  const verification = await inspectBoundAgentCapability(
    bindings.RUNTIME_ACTION_TOKEN_SECRET,
    token,
    nowMs,
  );

  if (verification.status !== "valid") {
    if (verification.status === "expired") {
      logDeploymentCapabilityRejection(verification.claims, "expired");
    }

    throw publicUnauthenticated(DEPLOYMENT_CAPABILITY_INVALID_MESSAGE);
  }

  const claims = verification.claims;
  const agent = await ensureDeploymentCapabilityAuthorized(bindings.DB, claims);
  const app = await getAppRow(bindings.DB, agent.appId);
  const ownerViewer = await getAccountViewer(bindings.DB, app.ownerAccountId);

  if (ownerViewer === null) {
    throw publicNotFound("App owner account was not found.");
  }

  return { agent, claims, ownerViewer };
}

export function toDeploymentCapabilityCaller(
  admission: DeploymentCapabilityAdmission,
): DeploymentCapabilityPublicApiCaller {
  return {
    capability: admission.claims,
    credentialSubjectId: toDeploymentCapabilityCredentialSubjectId(admission.claims.deploymentId),
    kind: "deployment_capability",
    viewer: admission.ownerViewer,
  };
}

/**
 * The capability URL is keyless, long-lived, and internet-facing: without a
 * limit a single leaked URL could launch unbounded owner-billed runs. Reuse the
 * shared public-API limiter keyed on the capability identity, in a dedicated
 * `bound:` bucket namespace so it never collides with Access Token ids.
 */
export function deploymentCapabilityRateLimitKey(claims: AppAgentCapabilityClaims): string {
  return `bound:${claims.appId}:${claims.agentId}`;
}

export function createDeploymentCapabilityRunAdmission(
  claims: AppAgentCapabilityClaims,
): BoundCapabilityRunAdmission {
  return {
    boundCapabilityProvenance: {
      agentId: claims.agentId,
      appId: claims.appId,
      bindingEnv: claims.binding.env,
      bindingName: claims.binding.name,
      deploymentId: claims.deploymentId,
      deploymentRunId: claims.deploymentRunId,
    },
    runCreationGuard: createDeploymentAgentCapabilityRunCreationGuard(claims),
  };
}
