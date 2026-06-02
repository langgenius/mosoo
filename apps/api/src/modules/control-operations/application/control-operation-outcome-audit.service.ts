import { agentsTable, sessionsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { AgentId, OrganizationId, SessionId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { API_ERROR_CODE, toApiErrorResponseDetails } from "../../../platform/errors";
import type { ApiErrorCode, ApiErrorStatus } from "../../../platform/errors";
import { isTruthy } from "../../../shared/truthiness";
import {
  appendAuditEvent,
  resolveViewerAuditActor,
} from "../../audit/application/audit-query.service";
import {
  AUDIT_OUTCOME,
  AUDIT_RESOURCE,
  AUDIT_VERB,
  createAuditAction,
} from "../../audit/domain/audit-vocabulary";
import type { AuditOutcome } from "../../audit/domain/audit-vocabulary";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import type { ControlOperationAuditIntent } from "./control-operation-registry";
import { getControlOperationAuditIntent } from "./control-operation-registry";

interface ControlOperationAuditResourceContext {
  readonly organizationId?: OrganizationId | null;
  readonly resourceDisplay?: string | null;
  readonly resourceId?: string | null;
  readonly sessionId?: SessionId | null;
}

const RESOURCE_ID_KEYS = [
  "agentId",
  "spaceId",
  "skillId",
  "sessionId",
  "environmentId",
  "serverId",
  "bindingId",
  "credentialId",
  "accountId",
  "invitationId",
  "requestId",
] as const;

const RESOURCE_DISPLAY_KEYS = ["name", "title", "email", "resourceDisplay", "displayName"] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getStringField(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  return typeof value === "string" && value.trim() ? value : null;
}

function getOperationFields(args: unknown): Record<string, unknown> {
  const root = asRecord(args);
  return {
    ...root,
    ...asRecord(root["input"]),
  };
}

function firstStringField(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = getStringField(record, key);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function readAgentId(value: string): AgentId {
  return parsePlatformId(value, "agent ID");
}

function readOrganizationId(value: string): OrganizationId {
  return parsePlatformId(value, "organization ID");
}

function readSessionId(value: string): SessionId {
  return parsePlatformId(value, "session ID");
}

function tryReadControlOperationId<TId>(
  value: string | null,
  reader: (value: string) => TId,
): TId | null {
  if (value === null) {
    return null;
  }

  try {
    return reader(value);
  } catch {
    return null;
  }
}

function tryReadAgentId(value: string | null): AgentId | null {
  return tryReadControlOperationId(value, readAgentId);
}

function tryReadOrganizationId(value: string | null): OrganizationId | null {
  return tryReadControlOperationId(value, readOrganizationId);
}

function tryReadSessionId(value: string | null): SessionId | null {
  return tryReadControlOperationId(value, readSessionId);
}

function getResultFields(result: unknown): Record<string, unknown> {
  const root = asRecord(result);
  return {
    ...root,
    ...asRecord(root["agent"]),
    ...asRecord(root["organization"]),
    ...asRecord(root["session"]),
    ...asRecord(root["space"]),
  };
}

async function resolveControlOperationAuditResourceContext(
  database: D1Database,
  intent: ControlOperationAuditIntent,
  fields: Record<string, unknown>,
): Promise<ControlOperationAuditResourceContext> {
  if (intent.resourceLookupType === "agent") {
    const rawAgentId = firstStringField(fields, ["agentId"]);
    if (rawAgentId === null) {
      return {};
    }

    const agentId = tryReadAgentId(rawAgentId);
    if (agentId === null) {
      return {
        resourceId: rawAgentId,
      };
    }

    const agent =
      (await getAppDatabase(database)
        .select({
          id: agentsTable.id,
          name: agentsTable.name,
          organizationId: agentsTable.organizationId,
        })
        .from(agentsTable)
        .where(eq(agentsTable.id, agentId))
        .limit(1)
        .get()) ?? null;

    if (!agent) {
      return {
        resourceId: agentId,
      };
    }

    return {
      organizationId: agent.organizationId,
      resourceDisplay: agent.name,
      resourceId: agent.id,
    };
  }

  if (intent.resourceLookupType !== "session") {
    return {};
  }

  const rawSessionId = firstStringField(fields, ["sessionId"]);
  if (rawSessionId === null) {
    return {};
  }

  const sessionId = tryReadSessionId(rawSessionId);
  if (sessionId === null) {
    return {
      resourceId: rawSessionId,
      sessionId: null,
    };
  }

  const session =
    (await getAppDatabase(database)
      .select({
        id: sessionsTable.id,
        organizationId: sessionsTable.organizationId,
        title: sessionsTable.title,
      })
      .from(sessionsTable)
      .where(eq(sessionsTable.id, sessionId))
      .limit(1)
      .get()) ?? null;

  if (!session) {
    return {
      resourceId: sessionId,
      sessionId,
    };
  }

  return {
    organizationId: session.organizationId,
    resourceDisplay: session.title ?? "Untitled session",
    resourceId: session.id,
    sessionId: session.id,
  };
}

function inferControlOperationAuditIntent(
  operationName: string,
  args: unknown,
): ControlOperationAuditIntent | null {
  const base = getControlOperationAuditIntent(operationName);
  if (!base) {
    return null;
  }

  const fields = getOperationFields(args);
  const action =
    operationName === "reviewOrganizationAccessRequest" && fields["decision"] === "reject"
      ? createAuditAction(AUDIT_RESOURCE.member, AUDIT_VERB.update)
      : base.action;

  return {
    ...base,
    action,
    organizationId: getStringField(fields, "organizationId"),
    resourceId: firstStringField(fields, RESOURCE_ID_KEYS),
  };
}

function createAuditMetadata(input: {
  errorClass?: string | undefined;
  errorMessage?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  operationName: string;
}): Record<string, unknown> {
  return {
    ...input.metadata,
    ...(isTruthy(input.errorClass) ? { errorClass: input.errorClass } : {}),
    ...(isTruthy(input.errorMessage) ? { reason: input.errorMessage } : {}),
    operationName: input.operationName,
  };
}

function getErrorMessage(error: unknown, defaultMessage: string): string {
  return error instanceof Error ? error.message : defaultMessage;
}

function createDeniedAuditMetadata(error: unknown): {
  errorCode: ApiErrorCode;
  reason: string;
  status: ApiErrorStatus;
} {
  const details = toApiErrorResponseDetails(error, {
    code: API_ERROR_CODE.forbidden,
    message: getErrorMessage(error, "Unknown permission failure."),
  });

  return {
    errorCode: details.code,
    reason: details.message,
    status: details.status,
  };
}

async function appendControlOperationAuditEvent(
  database: D1Database,
  input: {
    readonly args?: unknown;
    readonly errorClass?: string | undefined;
    readonly errorMessage?: string | undefined;
    readonly metadata?: Record<string, unknown> | undefined;
    readonly operationName: string;
    readonly organizationId?: OrganizationId | null | undefined;
    readonly outcome: AuditOutcome;
    readonly resourceDisplay?: string | null | undefined;
    readonly resourceId?: string | null | undefined;
    readonly result?: unknown;
    readonly sessionId?: SessionId | null | undefined;
    readonly viewer: AuthenticatedViewer;
  },
): Promise<void> {
  try {
    const intent = inferControlOperationAuditIntent(input.operationName, input.args);
    if (!intent) {
      return;
    }

    const fields = getOperationFields(input.args);
    const resultFields = getResultFields(input.result);
    const resourceContext = await resolveControlOperationAuditResourceContext(
      database,
      intent,
      fields,
    );
    const usesResourceLookup = intent.resourceLookupType !== undefined;
    const fallbackOrganizationId = tryReadOrganizationId(
      intent.organizationId ??
        getStringField(resultFields, "organizationId") ??
        getStringField(resultFields, "organization_id"),
    );
    const organizationId =
      input.organizationId ??
      (usesResourceLookup ? resourceContext.organizationId : fallbackOrganizationId);

    if (!isTruthy(organizationId)) {
      return;
    }

    const fallbackResourceId =
      intent.resourceId ?? getStringField(resultFields, "id") ?? getStringField(fields, "id");
    const resourceId =
      input.resourceId ?? (usesResourceLookup ? resourceContext.resourceId : fallbackResourceId);
    const fallbackResourceDisplay =
      firstStringField(resultFields, RESOURCE_DISPLAY_KEYS) ??
      firstStringField(fields, RESOURCE_DISPLAY_KEYS);
    const resourceDisplay =
      input.resourceDisplay ??
      (usesResourceLookup ? resourceContext.resourceDisplay : fallbackResourceDisplay);
    const sessionId =
      input.sessionId ??
      resourceContext.sessionId ??
      (intent.resourceType === AUDIT_RESOURCE.session ? (resourceId ?? null) : null);

    await appendAuditEvent(database, {
      action: intent.action,
      ...resolveViewerAuditActor(input.viewer),
      metadata: createAuditMetadata(input),
      organizationId,
      outcome: input.outcome,
      resourceDisplay: resourceDisplay ?? null,
      resourceId: resourceId ?? null,
      resourceType: intent.resourceType,
      sessionId,
    });
  } catch (error) {
    try {
      const { createErrorLogContext, logError } =
        await import("../../../platform/cloudflare/logger");
      logError("audit.control_operation_outcome_append.failed", {
        ...createErrorLogContext(error),
        operationName: input.operationName,
        outcome: input.outcome,
      });
    } catch {
      return;
    }
  }
}

export async function appendDeniedControlOperationAuditEvent(
  database: D1Database,
  input: {
    readonly args: unknown;
    readonly error: unknown;
    readonly operationName: string;
    readonly viewer: AuthenticatedViewer;
  },
): Promise<void> {
  await appendControlOperationAuditEvent(database, {
    args: input.args,
    metadata: createDeniedAuditMetadata(input.error),
    operationName: input.operationName,
    outcome: AUDIT_OUTCOME.denied,
    viewer: input.viewer,
  });
}

export async function appendFailedControlOperationAuditEvent(
  database: D1Database,
  input: {
    readonly args: unknown;
    readonly errorClass: string;
    readonly errorMessage: string;
    readonly operationName: string;
    readonly viewer: AuthenticatedViewer;
  },
): Promise<void> {
  await appendControlOperationAuditEvent(database, {
    ...input,
    outcome: AUDIT_OUTCOME.failure,
  });
}

export async function appendSuccessfulControlOperationAuditEvent(
  database: D1Database,
  input: {
    readonly metadata?: Record<string, unknown> | undefined;
    readonly operationName: string;
    readonly organizationId: OrganizationId;
    readonly resourceDisplay?: string | null | undefined;
    readonly resourceId?: string | null | undefined;
    readonly sessionId?: SessionId | null | undefined;
    readonly viewer: AuthenticatedViewer;
  },
): Promise<void> {
  await appendControlOperationAuditEvent(database, {
    metadata: input.metadata,
    operationName: input.operationName,
    organizationId: input.organizationId,
    outcome: AUDIT_OUTCOME.success,
    resourceDisplay: input.resourceDisplay,
    resourceId: input.resourceId,
    sessionId: input.sessionId,
    viewer: input.viewer,
  });
}
