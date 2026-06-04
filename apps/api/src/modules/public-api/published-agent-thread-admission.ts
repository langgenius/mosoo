import type {
  AccountId,
  AgentId,
  OrganizationId,
  PersonalAccessTokenId,
  PlatformId,
} from "@mosoo/id";

import type { PublicApiCaller } from "../auth/application/public-api-caller.service";
import { getAccountViewer } from "../auth/application/public-api-caller.service";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";
import { admitPublishedAgentCaller } from "./published-agent-admission.service";
import { publicNotFound } from "./published-agent-api-errors";
import type { PublicApiThreadCreatedByMetadata } from "./published-agent-thread-metadata";
import type { PublicApiThreadMetadata } from "./published-agent-thread-metadata";

export interface ThreadCreationAdmission {
  accessViewer: AuthenticatedViewer;
  attributedUserId: AccountId | null;
  createdById: PlatformId;
  createdByKind: PublicApiThreadCreatedByMetadata["kind"];
  creatorViewer: AuthenticatedViewer;
  executionOwnerId: AccountId;
  fileViewer: AuthenticatedViewer;
  organizationId: OrganizationId;
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
    (snapshot.metadata.created_by.kind === "human_pat" &&
      snapshot.row.creator_account_id === caller.viewer.id)
  );
}

export async function admitPublishedThreadReader(
  database: D1Database,
  caller: PublicApiCaller,
  snapshot: ThreadReadSnapshot,
): Promise<void> {
  if (!canReadThreadFromOwnership(caller, snapshot)) {
    throw publicNotFound("Thread not found.");
  }

  await admitPublishedAgentCaller(database, caller.viewer, snapshot.session.agentId);
}

export async function admitPublishedThreadCreator(
  database: D1Database,
  caller: PublicApiCaller,
  input: {
    agentId: AgentId;
  },
): Promise<ThreadCreationAdmission> {
  const agent = await admitPublishedAgentCaller(database, caller.viewer, input.agentId);
  return {
    accessViewer: await getOwnerViewer(database, agent.ownerId),
    attributedUserId: caller.viewer.id,
    createdById: caller.viewer.id,
    createdByKind: "human_pat",
    creatorViewer: caller.viewer,
    executionOwnerId: agent.ownerId,
    fileViewer: caller.viewer,
    organizationId: agent.organizationId,
    tokenId: caller.tokenId,
    tokenLabel: caller.tokenLabel,
  };
}
