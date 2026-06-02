import type { AuditEventId, OrganizationId, PlatformId, SessionId } from "@mosoo/id";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "./id-column";

export const auditVerbs = [
  "create",
  "update",
  "delete",
  "publish",
  "unpublish",
  "share",
  "unshare",
  "fork",
  "login",
  "logout",
  "export",
] as const;

export type AuditVerb = (typeof auditVerbs)[number];

export const auditSchemaMetadata = {
  sensitiveFields: [
    "password_hash",
    "api_key_raw",
    "bearer_token",
    "refresh_token",
    "client_secret",
    "private_key",
    "ssh_key",
    "jwt",
    "signature",
    "cookie",
    "session_token",
    "access_token",
    "id_token",
    "password",
    "token",
    "token_hash",
  ],
} as const;

export const auditSensitiveFields = auditSchemaMetadata.sensitiveFields;

export const auditEventsTable = sqliteTable(
  "audit_event",
  {
    action: text("action").notNull(),
    afterJson: text("after_json"),
    actorDisplay: text("actor_display").notNull(),
    actorId: platformIdColumn<PlatformId>("actor_id"),
    actorType: text("actor_type").$type<"agent" | "api_key" | "system" | "user">().notNull(),
    beforeJson: text("before_json"),
    correlationId: text("correlation_id"),
    id: platformIdColumn<AuditEventId>("id").primaryKey(),
    ipAddress: text("ip_address"),
    metadataJson: text("metadata_json"),
    organizationId: platformIdColumn<OrganizationId>("organization_id").notNull(),
    outcome: text("outcome").$type<"denied" | "failure" | "success">().notNull(),
    resourceDisplay: text("resource_display"),
    resourceId: platformIdColumn<PlatformId>("resource_id"),
    resourceType: text("resource_type").notNull(),
    sessionId: platformIdColumn<SessionId>("session_id"),
    timestamp: integer("timestamp").notNull(),
    userAgent: text("user_agent"),
  },
  (table) => [
    check(
      "audit_event_actor_type_check",
      sql`${table.actorType} IN ('user', 'agent', 'system', 'api_key')`,
    ),
    check("audit_event_outcome_check", sql`${table.outcome} IN ('success', 'failure', 'denied')`),
    index("audit_event_organization_time_idx").on(table.organizationId, table.timestamp),
    index("audit_event_actor_idx").on(table.actorId, table.timestamp),
    index("audit_event_action_idx").on(table.action, table.timestamp),
    index("audit_event_resource_idx").on(table.resourceType, table.resourceId),
    index("audit_event_correlation_idx").on(table.correlationId),
  ],
);

export type AuditEventRow = typeof auditEventsTable.$inferSelect;
