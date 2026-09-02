import type { AccountId, AgentId, ProjectId, PlatformId } from "@mosoo/id";

import type { PersonalAccessTokenCaller } from "../auth/application/personal-access-token.service";
import { getAccountViewer } from "../auth/application/viewer-auth.service";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";
import { admitAgentApiEndpointCaller } from "./agent-api-endpoint-admission.service";
import { publicNotFound } from "./public-api-errors";
import type { PublicApiThreadCreatedByMetadata } from "./public-thread-metadata";

export interface ThreadCreationAdmission {
  accessViewer: AuthenticatedViewer;
  creatorViewer: AuthenticatedViewer;
  fileViewer: AuthenticatedViewer;
  projectId: ProjectId;
  createdBy: PublicApiThreadCreatedByMetadata;
}

interface ThreadReadSnapshot {
  row: {
    creator_account_id: PlatformId;
  };
  session: {
    agentId: AgentId;
    projectId: ProjectId;
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
function toPublicApiThreadCreatedBy(
  caller: PersonalAccessTokenCaller,
): PublicApiThreadCreatedByMetadata {
  return {
    token_id: caller.tokenId,
    token_label: caller.tokenLabel,
  };
}

function canReadThreadFromOwnership(
  caller: AuthenticatedViewer,
  snapshot: ThreadReadSnapshot,
): boolean {
  return snapshot.row.creator_account_id === caller.id;
}

export async function admitPublicThreadReader(
  database: D1Database,
  caller: AuthenticatedViewer,
  snapshot: ThreadReadSnapshot,
): Promise<void> {
  if (!canReadThreadFromOwnership(caller, snapshot)) {
    throw publicNotFound("Thread not found.");
  }

  await admitAgentApiEndpointCaller(database, caller, snapshot.session.agentId);
}

export async function admitPublicThreadCreator(
  database: D1Database,
  caller: PersonalAccessTokenCaller,
  input: {
    agentId: AgentId;
  },
): Promise<ThreadCreationAdmission> {
  const agent = await admitAgentApiEndpointCaller(database, caller.viewer, input.agentId);

  return {
    accessViewer: await getOwnerViewer(database, agent.ownerId),
    creatorViewer: caller.viewer,
    fileViewer: caller.viewer,
    projectId: agent.projectId,
    createdBy: toPublicApiThreadCreatedBy(caller),
  };
}
