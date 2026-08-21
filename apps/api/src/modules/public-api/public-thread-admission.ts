import type { AccountId, AgentId, AppId, PlatformId } from "@mosoo/id";

import type { PublicApiCaller } from "../auth/application/public-api-caller.service";
import { getAccountViewer } from "../auth/application/public-api-caller.service";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";
import { admitAgentApiEndpointCaller } from "./agent-api-endpoint-admission.service";
import { publicNotFound } from "./public-api-errors";
import { isDeploymentCapabilityCreatedBy } from "./public-thread-metadata";
import type {
  PublicApiThreadCreatedByMetadata,
  PublicApiThreadMetadata,
} from "./public-thread-metadata";

export interface ThreadCreationAdmission {
  accessViewer: AuthenticatedViewer;
  creatorViewer: AuthenticatedViewer;
  fileViewer: AuthenticatedViewer;
  appId: AppId;
  createdBy: PublicApiThreadCreatedByMetadata;
}

interface ThreadReadSnapshot {
  metadata: PublicApiThreadMetadata;
  row: {
    creator_account_id: PlatformId;
  };
  session: {
    agentId: AgentId;
    appId: AppId;
  };
}

async function getOwnerViewer(
  database: D1Database,
  accountId: AccountId,
): Promise<AuthenticatedViewer> {
  const viewer = await getAccountViewer(database, accountId);

  if (!viewer) {
    throw publicNotFound("Agent owner account was not found.");
  }

  return viewer;
}

/** The `created_by` facts a caller stamps on every Thread it creates. */
export function toPublicApiThreadCreatedBy(
  caller: PublicApiCaller,
): PublicApiThreadCreatedByMetadata {
  if (caller.kind === "deployment_capability") {
    return {
      binding_env: caller.capability.binding.env,
      binding_name: caller.capability.binding.name,
      deployment_id: caller.capability.deploymentId,
      deployment_run_id: caller.capability.deploymentRunId,
      kind: "deployment_capability",
    };
  }

  return {
    token_id: caller.tokenId,
    token_label: caller.tokenLabel,
  };
}

/**
 * A deployment capability may only address the Agent its binding declared.
 * Any other Agent id — even one the App owner controls — is indistinguishable
 * from a missing Agent to the deployed App.
 */
function ensureCapabilityAgent(caller: PublicApiCaller, agentId: AgentId): void {
  if (caller.kind === "deployment_capability" && caller.capability.agentId !== agentId) {
    throw publicNotFound("Agent not found.");
  }
}

function canReadThreadFromOwnership(
  caller: PublicApiCaller,
  snapshot: ThreadReadSnapshot,
): boolean {
  if (snapshot.row.creator_account_id !== caller.viewer.id) {
    return false;
  }

  if (caller.kind !== "deployment_capability") {
    return true;
  }

  const createdBy = snapshot.metadata.created_by;

  return (
    isDeploymentCapabilityCreatedBy(createdBy) &&
    createdBy.deployment_id === caller.capability.deploymentId &&
    snapshot.session.agentId === caller.capability.agentId &&
    snapshot.session.appId === caller.capability.appId
  );
}

export async function admitPublicThreadReader(
  database: D1Database,
  caller: PublicApiCaller,
  snapshot: ThreadReadSnapshot,
): Promise<void> {
  if (!canReadThreadFromOwnership(caller, snapshot)) {
    throw publicNotFound("Thread not found.");
  }

  await admitAgentApiEndpointCaller(database, caller.viewer, snapshot.session.agentId);
}

export async function admitPublicThreadCreator(
  database: D1Database,
  caller: PublicApiCaller,
  input: {
    agentId: AgentId;
  },
): Promise<ThreadCreationAdmission> {
  ensureCapabilityAgent(caller, input.agentId);

  const agent = await admitAgentApiEndpointCaller(database, caller.viewer, input.agentId);

  if (caller.kind === "deployment_capability" && agent.appId !== caller.capability.appId) {
    throw publicNotFound("Agent not found.");
  }

  return {
    accessViewer: await getOwnerViewer(database, agent.ownerId),
    creatorViewer: caller.viewer,
    fileViewer: caller.viewer,
    appId: agent.appId,
    createdBy: toPublicApiThreadCreatedBy(caller),
  };
}
