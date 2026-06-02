import { Permission } from "@mosoo/contracts/permission";
import type { OrganizationId } from "@mosoo/id";

import { isApiError } from "../../../platform/errors";
import { AUDIT_ACTION, AUDIT_OUTCOME, AUDIT_RESOURCE } from "../domain/audit-vocabulary";
import type { AuditOutcome } from "../domain/audit-vocabulary";
import { resolveViewerAuditActor } from "./audit-query.service";
import type { AuditEventView } from "./audit-query.service";
import { appendAuditEvent, listAuditEvents } from "./audit-query.service";

const AUDIT_CSV_HEADER = [
  "Event ID",
  "Time (ISO 8601 UTC)",
  "Actor",
  "Action",
  "Resource Type",
  "Resource Display",
  "Outcome",
  "IP",
] as const;

export interface AuditExportFilter {
  organizationId: OrganizationId;
  outcome?: AuditOutcome | null;
  q?: string | null;
  startMs?: number | null;
}

function auditExportFilterMetadata(filter: AuditExportFilter): Record<string, unknown> {
  return {
    outcome: filter.outcome ?? "all",
    q: filter.q?.trim() ?? "",
    startMs: filter.startMs ?? "",
  };
}

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

function buildAuditExportFilename(date = new Date()): string {
  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  const hour = padDatePart(date.getHours());
  const minute = padDatePart(date.getMinutes());
  return `audit-events-${year}${month}${day}${hour}${minute}.csv`;
}

function escapeCsvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function buildAuditEventsCsv(events: readonly AuditEventView[]): string {
  const rows = events.map((event) => [
    event.id,
    event.timestamp,
    event.actor.display,
    event.action,
    event.resourceType,
    event.resourceDisplay ?? "",
    event.outcome,
    event.ipAddress ?? "",
  ]);

  return `${[AUDIT_CSV_HEADER.join(","), ...rows.map((row) => row.map(escapeCsvCell).join(","))].join("\r\n")}\r\n`;
}

export async function exportAuditEventsCsv(
  database: D1Database,
  viewer: Parameters<typeof listAuditEvents>[1],
  filter: AuditExportFilter,
): Promise<{ csv: string; filename: string }> {
  const actor = resolveViewerAuditActor(viewer);
  let events: AuditEventView[];

  try {
    events = await listAuditEvents(database, viewer, filter, Permission.AuditOrganizationExport);
  } catch (error) {
    if (isApiError(error) && error.status === 403) {
      await appendAuditEvent(database, {
        action: AUDIT_ACTION.auditLogExport,
        ...actor,
        metadata: {
          ...auditExportFilterMetadata(filter),
          errorCode: error.code,
          reason: error.message,
        },
        organizationId: filter.organizationId,
        outcome: AUDIT_OUTCOME.denied,
        resourceDisplay: "Audit Log",
        resourceId: null,
        resourceType: AUDIT_RESOURCE.auditLog,
      });
    }

    throw error;
  }

  const csv = buildAuditEventsCsv(events);
  const filename = buildAuditExportFilename();

  await appendAuditEvent(database, {
    action: AUDIT_ACTION.auditLogExport,
    ...actor,
    metadata: {
      ...auditExportFilterMetadata(filter),
      exportedRowCount: events.length,
    },
    organizationId: filter.organizationId,
    outcome: AUDIT_OUTCOME.success,
    resourceDisplay: "Audit Log",
    resourceId: null,
    resourceType: AUDIT_RESOURCE.auditLog,
  });

  return { csv, filename };
}
