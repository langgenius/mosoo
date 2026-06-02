import { Permission, can } from "@mosoo/contracts/permission";
import type { AgentId } from "@mosoo/id";

import { isApiError } from "../../platform/errors";
import { isTruthy } from "../../shared/truthiness";
import type { AgentViewerAccessFacts } from "../agents/application/agent-repository";
import {
  getAgentAccessRecord,
  getAgentViewerAccessFacts,
} from "../agents/application/agent-repository";
import type { AgentRow } from "../agents/application/agent-types";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";
import {
  publicAgentNotPublished,
  publicForbidden,
  publicNotFound,
  publicServiceInactive,
} from "./published-agent-api-errors";
export async function admitPublishedAgentCaller(
  database: D1Database,
  caller: AuthenticatedViewer,
  agentId: AgentId,
): Promise<AgentRow> {
  const access = await getAgentAccessRecord(database, caller.id, agentId).catch(
    (error: unknown) => {
      if (isApiError(error) && error.status === 404) {
        throw publicNotFound("Agent not found.");
      }

      throw error;
    },
  );

  ensurePublishedAgentCallerAccessFromFacts(caller, access.agent, access);

  return access.agent;
}

export async function ensurePublishedAgentCallerAccess(
  database: D1Database,
  caller: AuthenticatedViewer,
  agent: AgentRow,
): Promise<void> {
  ensurePublishedAgentCallerAccessFromFacts(
    caller,
    agent,
    await getAgentViewerAccessFacts(database, caller.id, agent),
  );
}

function ensurePublishedAgentCallerAccessFromFacts(
  caller: AuthenticatedViewer,
  agent: AgentRow,
  access: AgentViewerAccessFacts,
): void {
  if (agent.status !== "published") {
    throw publicAgentNotPublished("This Agent is not published as an active API service.");
  }

  if (!isTruthy(agent.liveDeploymentVersionId)) {
    throw publicServiceInactive("This Agent does not have a live published version.");
  }

  if (access.viewerMembershipRole === null || access.viewerMembershipDisabledAt !== null) {
    throw publicForbidden("Caller is not an active member of this Agent organization.");
  }

  if (agent.ownerId === caller.id || can(access.viewerMembershipRole, Permission.AgentsListAll)) {
    return;
  }

  if (access.viewerAclRoleRank === 0) {
    throw publicForbidden("Caller is not allowed by this Agent access mode.");
  }
}
