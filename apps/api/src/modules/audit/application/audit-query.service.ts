import { Permission } from "@mosoo/contracts/permission";
import { auditEventsTable, auditSensitiveFields } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { OrganizationId, SessionId } from "@mosoo/id";
import { getActiveLogContext } from "@mosoo/observability";
import type { SQL } from "drizzle-orm";
import { and, desc, eq, gte, like, lt, or } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { toNullablePlatformId, toPlatformId } from "../../../shared/platform-id";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs, toIsoString } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureOrganizationPermission } from "../../organizations/domain/organization-access.policy";
import { AUDIT_OUTCOME } from "../domain/audit-vocabulary";
import type { AuditAction, AuditOutcome, AuditResourceType } from "../domain/audit-vocabulary";
type AuditActorType = "agent" | "api_key" | "system" | "user";
type AuditPrimitive = boolean | null | number | string;
type AuditRecord = Record<string, AuditPrimitive>;
type RawAuditRecord = Record<string, unknown>;

export interface AuditActorInput {
  display: string;
  id: string | null;
  ipAddress?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
  type: AuditActorType;
  userAgent?: string | null | undefined;
}

const AUDIT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const AUDIT_SENSITIVE_FIELD_SET = new Set<string>(auditSensitiveFields);
const AUDIT_INGRESS_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const AUDIT_TRACE_ID_PATTERN = /^[a-f0-9]{32}$/i;

const SENSITIVE_VALUE_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g,
  /x(?:ox[bpoars]|app)-[A-Za-z0-9-]{10,}/g,
  /gh[pousr]_[A-Za-z0-9]{36,}/g,
  /glpat-[A-Za-z0-9_-]{20,}/g,
  /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /(?<=Bearer\s+)[A-Za-z0-9_\-.~+/]+=*/gi,
];

export function redactSensitiveStringValue(value: string): string {
  let result = value;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    result = result.replace(pattern, "[redacted]");
  }
  return result;
}

function normalizeAuditFieldName(key: string): string {
  return key
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replaceAll(/[.\-\s]+/g, "_")
    .toLowerCase();
}

function isAuditSensitiveField(key: string): boolean {
  return AUDIT_SENSITIVE_FIELD_SET.has(normalizeAuditFieldName(key));
}

function toAuditPrimitive(value: unknown): AuditPrimitive {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }

  return JSON.stringify(value);
}

export function redactAuditPayload(value: unknown, key = ""): unknown {
  if (isTruthy(key) && isAuditSensitiveField(key)) {
    return "[redacted]";
  }

  if (typeof value === "string") {
    return redactSensitiveStringValue(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactAuditPayload(entry));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactAuditPayload(entryValue, entryKey),
      ]),
    );
  }

  return value;
}

function normalizeAndRedactAuditRecord(record: RawAuditRecord | undefined): AuditRecord {
  if (!record) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      toAuditPrimitive(redactAuditPayload(value, key)),
    ]),
  );
}

function hasRecordEntries(record: AuditRecord): boolean {
  return Object.keys(record).length > 0;
}

function serializeAuditRecord(record: AuditRecord): string | null {
  return hasRecordEntries(record) ? JSON.stringify(record) : null;
}

function decapitalize(value: string): string {
  return value.length > 0 ? `${value[0]?.toLowerCase() ?? ""}${value.slice(1)}` : value;
}

function getAuditVerb(action: string): string {
  return action.slice(action.lastIndexOf(".") + 1);
}

function createResourceSnapshot(input: {
  metadata: AuditRecord;
  resourceDisplay?: string | null | undefined;
  resourceId?: string | null | undefined;
  resourceType: string;
}): RawAuditRecord {
  return {
    ...input.metadata,
    ...(input.resourceDisplay ? { resourceDisplay: input.resourceDisplay } : {}),
    ...(input.resourceId ? { resourceId: input.resourceId } : {}),
    resourceType: input.resourceType,
  };
}

function inferAuditSnapshots(input: {
  action: string;
  metadata: AuditRecord;
  resourceDisplay?: string | null | undefined;
  resourceId?: string | null | undefined;
  resourceType: string;
}): { after: RawAuditRecord | undefined; before: RawAuditRecord | undefined } {
  const before: RawAuditRecord = {};
  const after: RawAuditRecord = {};

  for (const [key, value] of Object.entries(input.metadata)) {
    if (!key.startsWith("previous") || key.length === "previous".length) {
      continue;
    }

    const stateKey = decapitalize(key.slice("previous".length));
    before[stateKey] = value;

    if (Object.hasOwn(input.metadata, stateKey)) {
      after[stateKey] = input.metadata[stateKey];
    }
  }

  if (Object.keys(before).length > 0 || Object.keys(after).length > 0) {
    return { after, before };
  }

  const verb = getAuditVerb(input.action);
  if (verb === "create" || verb === "fork" || verb === "publish" || verb === "share") {
    return { after: createResourceSnapshot(input), before: undefined };
  }

  if (verb === "delete" || verb === "logout" || verb === "unpublish" || verb === "unshare") {
    return { after: undefined, before: createResourceSnapshot(input) };
  }

  return { after: undefined, before: undefined };
}

export function resolveViewerAuditActor(viewer: AuthenticatedViewer): {
  actorDisplay: string;
  actorId: string | null;
  actorMetadata: RawAuditRecord;
  actorType: AuditActorType;
  ipAddress: string | null;
  userAgent: string | null;
} {
  if (viewer.auditActor) {
    return {
      actorDisplay: viewer.auditActor.display,
      actorId: viewer.auditActor.id,
      actorMetadata: {
        ownerEmail: viewer.email,
        ...viewer.auditActor.metadata,
      },
      actorType: viewer.auditActor.type,
      ipAddress: viewer.auditContext?.ipAddress ?? null,
      userAgent: viewer.auditContext?.userAgent ?? null,
    };
  }

  return {
    actorDisplay: viewer.name || viewer.email,
    actorId: viewer.id,
    actorMetadata: { actorEmail: viewer.email },
    actorType: "user",
    ipAddress: viewer.auditContext?.ipAddress ?? null,
    userAgent: viewer.auditContext?.userAgent ?? null,
  };
}

export interface AuditEventView {
  action: string;
  actor: {
    display: string;
    id: string | null;
    type: AuditActorType;
  };
  after: AuditRecord;
  before: AuditRecord;
  correlationId: string | null;
  id: string;
  ipAddress: string | null;
  metadata: AuditRecord;
  outcome: AuditOutcome;
  resourceDisplay: string | null;
  resourceId: string | null;
  resourceType: string;
  sessionId: string | null;
  timestamp: string;
  userAgent: string | null;
}

interface AuditEventRow {
  action: string;
  after_json?: string | null;
  actor_display: string;
  actor_id: string | null;
  actor_type: AuditActorType;
  before_json?: string | null;
  correlation_id: string | null;
  id: string;
  ip_address: string | null;
  metadata_json: string | null;
  outcome: AuditOutcome;
  resource_display: string | null;
  resource_id: string | null;
  resource_type: string;
  session_id: string | null;
  timestamp: number;
  user_agent: string | null;
}

const auditEventRowColumns = {
  action: auditEventsTable.action,
  after_json: auditEventsTable.afterJson,
  actor_display: auditEventsTable.actorDisplay,
  actor_id: auditEventsTable.actorId,
  actor_type: auditEventsTable.actorType,
  before_json: auditEventsTable.beforeJson,
  correlation_id: auditEventsTable.correlationId,
  id: auditEventsTable.id,
  ip_address: auditEventsTable.ipAddress,
  metadata_json: auditEventsTable.metadataJson,
  outcome: auditEventsTable.outcome,
  resource_display: auditEventsTable.resourceDisplay,
  resource_id: auditEventsTable.resourceId,
  resource_type: auditEventsTable.resourceType,
  session_id: auditEventsTable.sessionId,
  timestamp: auditEventsTable.timestamp,
  user_agent: auditEventsTable.userAgent,
};

function parseJsonRecord(value: string | null): AuditRecord {
  if (!isTruthy(value)) {
    return {};
  }

  const parsed: unknown = JSON.parse(value);

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Stored audit JSON payload must be an object.");
  }

  return Object.fromEntries(
    Object.entries(parsed).map(([key, entry]) => {
      if (
        typeof entry === "string" ||
        typeof entry === "number" ||
        typeof entry === "boolean" ||
        entry === null
      ) {
        return [key, entry];
      }

      return [key, JSON.stringify(entry)];
    }),
  );
}

function toAuditEventView(row: AuditEventRow): AuditEventView {
  return {
    action: row.action,
    actor: {
      display: row.actor_display,
      id: row.actor_id,
      type: row.actor_type,
    },
    after: parseJsonRecord(row.after_json ?? null),
    before: parseJsonRecord(row.before_json ?? null),
    correlationId: row.correlation_id,
    id: row.id,
    ipAddress: row.ip_address,
    metadata: parseJsonRecord(row.metadata_json),
    outcome: row.outcome,
    resourceDisplay: row.resource_display,
    resourceId: row.resource_id,
    resourceType: row.resource_type,
    sessionId: row.session_id,
    timestamp: toIsoString(row.timestamp),
    userAgent: row.user_agent,
  };
}

interface AuditIngressMetadataProjection {
  correlationId: string | null;
  metadata: AuditRecord;
}

function readActiveAuditContextString(key: string, pattern: RegExp): string | null {
  const value = getActiveLogContext()?.[key];

  if (typeof value !== "string" || !pattern.test(value)) {
    return null;
  }

  return value;
}

function createAuditIngressMetadataProjection(input: {
  correlationId?: string | null | undefined;
}): AuditIngressMetadataProjection {
  const requestId = readActiveAuditContextString("requestId", AUDIT_INGRESS_ID_PATTERN);
  const traceId = readActiveAuditContextString("traceId", AUDIT_TRACE_ID_PATTERN);
  const activeCorrelationId = readActiveAuditContextString(
    "correlationId",
    AUDIT_INGRESS_ID_PATTERN,
  );
  const correlationId = input.correlationId ?? activeCorrelationId ?? requestId;

  return {
    correlationId,
    metadata: {
      ...(requestId === null ? {} : { requestId }),
      ...(traceId === null ? {} : { traceId }),
    },
  };
}

export async function appendAuditEvent(
  database: D1Database,
  input: {
    action: AuditAction;
    actorDisplay: string;
    actorId: string | null;
    actorMetadata?: Record<string, unknown> | undefined;
    actorType: AuditActorType;
    after?: RawAuditRecord | undefined;
    before?: RawAuditRecord | undefined;
    correlationId?: string | null;
    ipAddress?: string | null;
    metadata?: Record<string, unknown> | undefined;
    organizationId: string;
    outcome: AuditOutcome;
    resourceDisplay?: string | null;
    resourceId?: string | null;
    resourceType: AuditResourceType;
    sessionId?: string | null;
    userAgent?: string | null;
  },
): Promise<void> {
  const actorMetadata = normalizeAndRedactAuditRecord(input.actorMetadata);
  const eventMetadata = normalizeAndRedactAuditRecord(input.metadata);
  const ingressMetadata = createAuditIngressMetadataProjection({
    correlationId: input.correlationId,
  });
  const metadata = { ...ingressMetadata.metadata, ...actorMetadata, ...eventMetadata };
  const inferredSnapshots =
    input.outcome === AUDIT_OUTCOME.success
      ? inferAuditSnapshots({
          action: input.action,
          metadata: eventMetadata,
          resourceDisplay: input.resourceDisplay,
          resourceId: input.resourceId,
          resourceType: input.resourceType,
        })
      : { after: undefined, before: undefined };
  const before = normalizeAndRedactAuditRecord(input.before ?? inferredSnapshots.before);
  const after = normalizeAndRedactAuditRecord(input.after ?? inferredSnapshots.after);

  try {
    const actorId = toNullablePlatformId(input.actorId, "audit actor id");
    const organizationId = toPlatformId<OrganizationId>(
      input.organizationId,
      "audit organization id",
    );
    const resourceId = toNullablePlatformId(input.resourceId, "audit resource id");
    const sessionId = toNullablePlatformId<SessionId>(input.sessionId, "audit session id");

    await getAppDatabase(database)
      .insert(auditEventsTable)
      .values({
        action: input.action,
        actorDisplay: input.actorDisplay,
        actorId,
        actorType: input.actorType,
        afterJson: serializeAuditRecord(after),
        beforeJson: serializeAuditRecord(before),
        correlationId: ingressMetadata.correlationId,
        id: createPlatformId(),
        ipAddress: input.ipAddress ?? null,
        metadataJson: JSON.stringify(metadata),
        organizationId,
        outcome: input.outcome,
        resourceDisplay: input.resourceDisplay ?? null,
        resourceId,
        resourceType: input.resourceType,
        sessionId,
        timestamp: currentTimestampMs(),
        userAgent: input.userAgent ?? null,
      })
      .run();
  } catch (error) {
    try {
      const { createErrorLogContext, logError } =
        await import("../../../platform/cloudflare/logger");
      logError("audit.append.failed", {
        ...createErrorLogContext(error),
        action: input.action,
        actorType: input.actorType,
        organizationId: input.organizationId,
        outcome: input.outcome,
        resourceId: input.resourceId ?? null,
        resourceType: input.resourceType,
      });
    } catch {
      // Audit writes are best-effort and must not break the control-plane mutation.
    }
  }
}

export async function listAuditEvents(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: {
    organizationId: OrganizationId;
    outcome?: AuditOutcome | null;
    q?: string | null;
    startMs?: number | null;
  },
  permission: Permission = Permission.AuditOrganizationRead,
): Promise<AuditEventView[]> {
  await ensureOrganizationPermission(database, viewer.id, input.organizationId, permission);

  const filters: SQL[] = [eq(auditEventsTable.organizationId, input.organizationId)];

  if (isTruthy(input.startMs)) {
    filters.push(gte(auditEventsTable.timestamp, input.startMs));
  }

  if (input.outcome) {
    filters.push(eq(auditEventsTable.outcome, input.outcome));
  }

  const q = input.q?.trim();
  if (isTruthy(q)) {
    const pattern = `%${q}%`;
    const qFilter = or(
      like(auditEventsTable.actorDisplay, pattern),
      like(auditEventsTable.action, pattern),
      like(auditEventsTable.resourceType, pattern),
      like(auditEventsTable.resourceId, pattern),
      like(auditEventsTable.resourceDisplay, pattern),
    );

    if (qFilter) {
      filters.push(qFilter);
    }
  }

  const results = await getAppDatabase(database)
    .select(auditEventRowColumns)
    .from(auditEventsTable)
    .where(and(...filters))
    .orderBy(desc(auditEventsTable.timestamp))
    .all();

  return results.map(toAuditEventView);
}

export async function cleanupExpiredAuditEvents(
  database: D1Database,
  now = new Date(),
): Promise<void> {
  await getAppDatabase(database)
    .delete(auditEventsTable)
    .where(lt(auditEventsTable.timestamp, now.getTime() - AUDIT_RETENTION_MS))
    .run();
}
