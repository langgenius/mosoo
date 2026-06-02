import { sessionsTable } from "@mosoo/db";
import type {
  AccountId,
  AgentId,
  OrganizationId,
  PersonalAccessTokenId,
  PlatformId,
  PublicThreadId,
  SessionId,
} from "@mosoo/id";
import { eq } from "drizzle-orm";

import { createErrorLogContext, logError } from "../../platform/cloudflare/logger";
import { getAppDatabase } from "../../platform/db/drizzle";
import { isTruthy } from "../../shared/truthiness";
import { getAgentRow } from "../agents/application/agent-repository";
import type { AgentRow } from "../agents/application/agent-types";
import { appendAuditEvent } from "../audit/application/audit-query.service";
import type { AuditActorInput } from "../audit/application/audit-query.service";
import { AUDIT_OUTCOME, AUDIT_RESOURCE } from "../audit/domain/audit-vocabulary";
import type { AUDIT_ACTION } from "../audit/domain/audit-vocabulary";
import type { AuditOutcome } from "../audit/domain/audit-vocabulary";
import type { PublicApiCaller } from "../auth/application/public-api-caller.service";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";
import { toPublishedAgentApiError } from "./published-agent-api-errors";
import type { PublishedAgentApiError } from "./published-agent-api-errors";
import { toBackingSessionId } from "./published-agent-thread-ids";
export interface PublishedApiAuditOptions {
  tokenId?: PersonalAccessTokenId | undefined;
  tokenLabel?: string | undefined;
}

interface PublicApiSessionAuditTarget {
  agent: AgentRow | null;
  organizationId: OrganizationId;
  resourceDisplay: string | null;
  resourceId: SessionId | null;
}

type PublicApiSessionAuditAction =
  | typeof AUDIT_ACTION.sessionCreate
  | typeof AUDIT_ACTION.sessionDelete
  | typeof AUDIT_ACTION.sessionUpdate;

type PublicApiThreadReadAuditAction = typeof AUDIT_ACTION.sessionUpdate;

export interface PublishedApiThreadMutationAuditContext {
  attributedUserId?: AccountId | undefined;
  clientExternalRef?: string | undefined;
}

export function createPublishedApiAuditActor(input: {
  agent?: AgentRow | null | undefined;
  caller: AuthenticatedViewer;
  tokenId?: PlatformId | undefined;
  tokenLabel?: string | undefined;
}): AuditActorInput {
  const display = isTruthy(input.tokenLabel) ? `API Key: ${input.tokenLabel}` : "API Key";

  return {
    display,
    id: input.tokenId ?? null,
    metadata: {
      ...(input.agent
        ? {
            agentId: input.agent.id,
            agentName: input.agent.name,
            executionOwnerId: input.agent.ownerId,
          }
        : {}),
      ...(isTruthy(input.tokenId) ? { publicApiCredentialId: input.tokenId } : {}),
      ...(isTruthy(input.tokenLabel) ? { publicApiCredentialLabel: input.tokenLabel } : {}),
      ownerDisplay: input.caller.name || input.caller.email,
      ownerId: input.caller.id,
      source: "public_api",
    },
    type: "api_key",
  };
}

function createPublishedApiThreadAuditActor(input: {
  agent?: AgentRow | null | undefined;
  caller: PublicApiCaller;
}): AuditActorInput {
  if (input.caller.kind === "service_token") {
    return {
      display: `Service Token: ${input.caller.tokenLabel}`,
      id: input.caller.tokenId,
      metadata: {
        ...(input.agent
          ? {
              agentId: input.agent.id,
              agentName: input.agent.name,
              executionOwnerId: input.agent.ownerId,
            }
          : {}),
        organizationId: input.caller.organizationId,
        publicApiCredentialId: input.caller.tokenId,
        publicApiCredentialLabel: input.caller.tokenLabel,
        source: "public_api",
      },
      type: "api_key",
    };
  }

  return createPublishedApiAuditActor({
    agent: input.agent,
    caller: input.caller.viewer,
    tokenId: input.caller.tokenId,
    tokenLabel: input.caller.tokenLabel,
  });
}

async function getOptionalAgentRow(
  database: D1Database,
  agentId: AgentId,
): Promise<AgentRow | null> {
  try {
    return await getAgentRow(database, agentId);
  } catch (error) {
    if (error instanceof Error && error.message === "Agent not found.") {
      return null;
    }

    throw error;
  }
}

async function resolvePublicApiSessionAuditTarget(
  database: D1Database,
  input: { agentId?: AgentId | undefined; threadId?: PublicThreadId | undefined },
): Promise<PublicApiSessionAuditTarget | null> {
  if (isTruthy(input.agentId)) {
    const agent = await getOptionalAgentRow(database, input.agentId);
    return agent
      ? {
          agent,
          organizationId: agent.organizationId,
          resourceDisplay: `Session for ${agent.name}`,
          resourceId: null,
        }
      : null;
  }

  if (!isTruthy(input.threadId)) {
    return null;
  }

  const sessionId = toBackingSessionId(input.threadId);
  const session =
    (await getAppDatabase(database)
      .select({
        agentId: sessionsTable.agentId,
        organizationId: sessionsTable.organizationId,
        title: sessionsTable.title,
      })
      .from(sessionsTable)
      .where(eq(sessionsTable.id, sessionId))
      .limit(1)
      .get()) ?? null;

  if (!session) {
    return null;
  }

  return {
    agent: await getOptionalAgentRow(database, session.agentId),
    organizationId: session.organizationId,
    resourceDisplay: session.title,
    resourceId: sessionId,
  };
}

function resolvePublicApiSessionAuditOutcome(error: unknown): AuditOutcome | null {
  const publicError = toPublishedAgentApiError(error);

  if (!publicError) {
    return AUDIT_OUTCOME.failure;
  }

  if (publicError.status === 401) {
    return null;
  }

  return publicError.status === 403 || publicError.status === 404
    ? AUDIT_OUTCOME.denied
    : AUDIT_OUTCOME.failure;
}

function resolvePublicApiThreadAuditOutcome(error: unknown): AuditOutcome | null {
  const publicError = toPublishedAgentApiError(error);

  if (!publicError) {
    return AUDIT_OUTCOME.failure;
  }

  if (publicError.status === 401) {
    return null;
  }

  return publicError.status === 403 || publicError.status === 404
    ? AUDIT_OUTCOME.denied
    : AUDIT_OUTCOME.failure;
}

function resolvePublicApiThreadReadDeniedOutcome(error: unknown): AuditOutcome | null {
  const publicError = toPublishedAgentApiError(error);

  if (!publicError) {
    return null;
  }

  return publicError.status === 403 || publicError.status === 404 ? AUDIT_OUTCOME.denied : null;
}

function publicApiErrorAuditMetadata(error: unknown): {
  errorCode?: PublishedAgentApiError["code"] | undefined;
  reason: string;
  status?: PublishedAgentApiError["status"] | undefined;
} {
  const publicError = toPublishedAgentApiError(error);

  if (publicError) {
    return {
      errorCode: publicError.code,
      reason: publicError.message,
      status: publicError.status,
    };
  }

  return {
    reason: error instanceof Error ? error.message : String(error),
  };
}

export async function appendPublishedApiSessionMutationOutcomeAuditEvent(
  database: D1Database,
  caller: AuthenticatedViewer,
  input: PublishedApiAuditOptions & {
    action: PublicApiSessionAuditAction;
    agentId?: AgentId | undefined;
    error: unknown;
    threadId?: PublicThreadId | undefined;
  },
): Promise<void> {
  const outcome = resolvePublicApiSessionAuditOutcome(input.error);
  if (!outcome) {
    return;
  }

  try {
    const target = await resolvePublicApiSessionAuditTarget(database, input);
    if (!target) {
      return;
    }

    const actor = createPublishedApiAuditActor({
      agent: target.agent,
      caller,
      tokenId: input.tokenId,
      tokenLabel: input.tokenLabel,
    });
    const errorMetadata = publicApiErrorAuditMetadata(input.error);

    await appendAuditEvent(database, {
      action: input.action,
      actorDisplay: actor.display,
      actorId: actor.id,
      actorMetadata: actor.metadata,
      actorType: actor.type,
      metadata: {
        ...errorMetadata,
        source: "public_api",
      },
      organizationId: target.organizationId,
      outcome,
      resourceDisplay: target.resourceDisplay,
      resourceId: target.resourceId,
      resourceType: AUDIT_RESOURCE.session,
    });
  } catch (error) {
    logError("published-agent-api.audit_outcome_failed", createErrorLogContext(error));
  }
}

export async function appendPublishedApiThreadMutationOutcomeAuditEvent(
  database: D1Database,
  caller: PublicApiCaller,
  input: {
    action: PublicApiSessionAuditAction;
    agentId: AgentId;
    auditContext?: PublishedApiThreadMutationAuditContext | undefined;
    error: unknown;
  },
): Promise<void> {
  const outcome = resolvePublicApiThreadAuditOutcome(input.error);
  if (!outcome) {
    return;
  }

  try {
    const agent = await getOptionalAgentRow(database, input.agentId);
    if (!agent) {
      return;
    }

    const actor = createPublishedApiThreadAuditActor({ agent, caller });
    const errorMetadata = publicApiErrorAuditMetadata(input.error);

    await appendAuditEvent(database, {
      action: input.action,
      actorDisplay: actor.display,
      actorId: actor.id,
      actorMetadata: actor.metadata,
      actorType: actor.type,
      metadata: {
        ...errorMetadata,
        agentId: agent.id,
        ...(isTruthy(input.auditContext?.attributedUserId)
          ? { attributedUserId: input.auditContext.attributedUserId }
          : {}),
        ...(isTruthy(input.auditContext?.clientExternalRef)
          ? { clientExternalRef: input.auditContext.clientExternalRef }
          : {}),
        executionOwnerId: agent.ownerId,
        source: "public_api",
      },
      organizationId: agent.organizationId,
      outcome,
      resourceDisplay: `Thread for ${agent.name}`,
      resourceId: null,
      resourceType: AUDIT_RESOURCE.session,
    });
  } catch (error) {
    logError("published-agent-api.thread_audit_outcome_failed", createErrorLogContext(error));
  }
}

export async function appendPublishedApiThreadReadDeniedAuditEvent(
  database: D1Database,
  caller: PublicApiCaller,
  input: {
    action: PublicApiThreadReadAuditAction;
    error: unknown;
    threadId: PublicThreadId;
  },
): Promise<void> {
  const outcome = resolvePublicApiThreadReadDeniedOutcome(input.error);
  const publicError = toPublishedAgentApiError(input.error);

  if (!outcome || !publicError) {
    return;
  }

  try {
    const target = await resolvePublicApiSessionAuditTarget(database, {
      threadId: input.threadId,
    });
    if (!target) {
      return;
    }

    const actor = createPublishedApiThreadAuditActor({ agent: target.agent, caller });

    await appendAuditEvent(database, {
      action: input.action,
      actorDisplay: actor.display,
      actorId: actor.id,
      actorMetadata: actor.metadata,
      actorType: actor.type,
      metadata: {
        errorCode: publicError.code,
        reason: publicError.message,
        source: "public_api",
        status: publicError.status,
        threadId: input.threadId,
      },
      organizationId: target.organizationId,
      outcome,
      resourceDisplay: target.resourceDisplay,
      resourceId: target.resourceId,
      resourceType: AUDIT_RESOURCE.session,
      sessionId: target.resourceId,
    });
  } catch (error) {
    logError("published-agent-api.thread_read_denied_audit_failed", createErrorLogContext(error));
  }
}
