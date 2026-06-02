import { agentsTable, organizationServiceTokenAgentsTable } from "@mosoo/db";
import type {
  AccountId,
  AgentId,
  OrganizationId,
  OrganizationServiceTokenId,
  PersonalAccessTokenId,
  PlatformId,
} from "@mosoo/id";
import { and, eq } from "drizzle-orm";

import { getAppDatabase } from "../../platform/db/drizzle";
import { agentRowColumns } from "../agents/application/agent-repository";
import type { AgentRow } from "../agents/application/agent-types";
import type { PublicApiCaller } from "../auth/application/public-api-caller.service";
import { getAccountViewer } from "../auth/application/public-api-caller.service";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";
import {
  admitPublishedAgentCaller,
  ensurePublishedAgentCallerAccess,
} from "./published-agent-admission.service";
import {
  publicAgentNotPublished,
  publicForbidden,
  publicInvalidRequest,
  publicNotFound,
  publicServiceInactive,
} from "./published-agent-api-errors";
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
  tokenId: OrganizationServiceTokenId | PersonalAccessTokenId;
  tokenLabel: string;
}

interface ServiceTokenAgentAdmissionRow extends AgentRow {
  allowedTokenId: OrganizationServiceTokenId | null;
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

async function admitServiceTokenAgentAccess(input: {
  agentId: AgentId;
  caller: Extract<PublicApiCaller, { kind: "service_token" }>;
  database: D1Database;
}): Promise<AgentRow> {
  const row: ServiceTokenAgentAdmissionRow | null =
    (await getAppDatabase(input.database)
      .select({
        ...agentRowColumns,
        allowedTokenId: organizationServiceTokenAgentsTable.tokenId,
      })
      .from(agentsTable)
      .leftJoin(
        organizationServiceTokenAgentsTable,
        and(
          eq(organizationServiceTokenAgentsTable.tokenId, input.caller.tokenId),
          eq(organizationServiceTokenAgentsTable.organizationId, agentsTable.organizationId),
          eq(organizationServiceTokenAgentsTable.agentId, agentsTable.id),
        ),
      )
      .where(eq(agentsTable.id, input.agentId))
      .limit(1)
      .get()) ?? null;

  if (row === null) {
    throw publicNotFound("Agent not found.");
  }

  const { allowedTokenId, ...agent } = row;

  if (agent.status !== "published") {
    throw publicAgentNotPublished("This Agent is not published as an active API service.");
  }

  if (!agent.liveDeploymentVersionId) {
    throw publicServiceInactive("This Agent does not have a live published version.");
  }

  if (agent.organizationId !== input.caller.organizationId) {
    throw publicForbidden("Service token does not belong to this Agent organization.");
  }

  if (allowedTokenId === null) {
    throw publicForbidden("Service token is not allowed to invoke this Agent.");
  }

  return agent;
}

function canReadThreadFromOwnership(
  caller: PublicApiCaller,
  snapshot: ThreadReadSnapshot,
): boolean {
  if (caller.kind === "human_pat") {
    return (
      snapshot.row.attributed_user_id === caller.viewer.id ||
      (snapshot.metadata.created_by.kind === "human_pat" &&
        snapshot.row.creator_account_id === caller.viewer.id)
    );
  }

  return (
    snapshot.metadata.created_by.kind === "service_token" &&
    snapshot.metadata.created_by.service_token_id === caller.tokenId
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

  if (caller.kind === "human_pat") {
    await admitPublishedAgentCaller(database, caller.viewer, snapshot.session.agentId);
    return;
  }

  await admitServiceTokenAgentAccess({
    agentId: snapshot.session.agentId,
    caller,
    database,
  });
}

export async function admitPublishedThreadCreator(
  database: D1Database,
  caller: PublicApiCaller,
  input: {
    agentId: AgentId;
    attributedUserId?: AccountId | undefined;
  },
): Promise<ThreadCreationAdmission> {
  if (caller.kind === "human_pat") {
    if (input.attributedUserId !== undefined) {
      throw publicInvalidRequest("Human PAT callers cannot set attributed_user_id.");
    }

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

  const agent = await admitServiceTokenAgentAccess({
    agentId: input.agentId,
    caller,
    database,
  });
  const accessViewer = await getOwnerViewer(database, agent.ownerId);
  const tokenId = caller.tokenId;

  if (input.attributedUserId === undefined) {
    return {
      accessViewer,
      attributedUserId: null,
      createdById: tokenId,
      createdByKind: "service_token",
      creatorViewer: accessViewer,
      executionOwnerId: agent.ownerId,
      fileViewer: accessViewer,
      organizationId: agent.organizationId,
      tokenId,
      tokenLabel: caller.tokenLabel,
    };
  }

  if (!caller.allowAttribution) {
    throw publicForbidden("Service token is not allowed to set attributed_user_id.");
  }

  const attributedViewer = await getAccountViewer(database, input.attributedUserId);

  if (!attributedViewer) {
    throw publicNotFound("Attributed user was not found.");
  }

  await ensurePublishedAgentCallerAccess(database, attributedViewer, agent);

  return {
    accessViewer,
    attributedUserId: attributedViewer.id,
    createdById: tokenId,
    createdByKind: "service_token",
    creatorViewer: accessViewer,
    executionOwnerId: agent.ownerId,
    fileViewer: accessViewer,
    organizationId: agent.organizationId,
    tokenId,
    tokenLabel: caller.tokenLabel,
  };
}
