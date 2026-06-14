import type {
  AccountId,
  AgentId,
  OrganizationId,
  PersonalAccessTokenId,
  PlatformId,
  AppId,
} from "@mosoo/id";

import type { PublicApiCaller } from "../auth/application/public-api-caller.service";
import { getAccountViewer } from "../auth/application/public-api-caller.service";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";
import { admitAgentApiEndpointCaller } from "./agent-api-endpoint-admission.service";
import { publicNotFound } from "./public-api-errors";
import type { PublicApiThreadCreatedByMetadata } from "./public-thread-metadata";
import type { PublicApiThreadMetadata } from "./public-thread-metadata";

export interface ThreadCreationAdmission {
  accessViewer: AuthenticatedViewer;
  attributedUserId: AccountId | null;
  createdById: PlatformId;
  createdByKind: PublicApiThreadCreatedByMetadata["kind"];
  creatorViewer: AuthenticatedViewer;
  executionOwnerId: AccountId;
  fileViewer: AuthenticatedViewer;
  organizationId: OrganizationId;
  appId: AppId;
  tokenId: PersonalAccessTokenId;
  tokenLabel: string;
}

interface ThreadReadSnapshot {
  metadata: PublicApiThreadMetadata;
  row: {
    attributed_user_id: AccountId | null;
    creator_account_id: PlatformId;
  };
  session: {
    agentId: AgentId;
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

function canReadThreadFromOwnership(
  caller: PublicApiCaller,
  snapshot: ThreadReadSnapshot,
): boolean {
  return (
    snapshot.row.attributed_user_id === caller.viewer.id ||
    (snapshot.metadata.created_by.kind === "access_token" &&
      snapshot.row.creator_account_id === caller.viewer.id)
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
  const agent = await admitAgentApiEndpointCaller(database, caller.viewer, input.agentId);
  return {
    accessViewer: await getOwnerViewer(database, agent.ownerId),
    attributedUserId: caller.viewer.id,
    createdById: caller.viewer.id,
    createdByKind: "access_token",
    creatorViewer: caller.viewer,
    executionOwnerId: agent.ownerId,
    fileViewer: caller.viewer,
    organizationId: agent.appOrganizationId,
    appId: agent.appId,
    tokenId: caller.tokenId,
    tokenLabel: caller.tokenLabel,
  };
}
