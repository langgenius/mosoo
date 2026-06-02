import type { OrganizationId } from "@mosoo/contracts/id";

import { graphql } from "@/gql";
import type { AuditActorType, AuditEventFieldsFragment, AuditOutcome } from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";
import { apiFetch } from "@/platform/http/public-api";

export type { AuditActorType, AuditOutcome };
export type AuditEvent = AuditEventFieldsFragment;

const AUDIT_EVENT_FIELDS = graphql(/* GraphQL */ `
  fragment AuditEventFields on AuditEvent {
    action
    actor {
      display
      id
      type
    }
    after
    before
    correlationId
    id
    ipAddress
    metadata
    outcome
    resourceDisplay
    resourceId
    resourceType
    sessionId
    timestamp
    userAgent
  }
`);

const retainGraphQLFragments = (documents: readonly unknown[]): number => documents.length;

retainGraphQLFragments([AUDIT_EVENT_FIELDS]);

const AUDIT_EVENTS_QUERY = graphql(/* GraphQL */ `
  query AuditEvents($filter: AuditEventsFilterInput!) {
    auditEvents(filter: $filter) {
      ...AuditEventFields
    }
  }
`);

export interface AuditEventsInput {
  organizationId: OrganizationId;
  outcome?: AuditOutcome;
  q?: string;
  startMs?: number;
}

export async function fetchAuditEvents(input: AuditEventsInput): Promise<AuditEvent[]> {
  const payload = await requestGraphQL(AUDIT_EVENTS_QUERY, { filter: input });
  return payload.auditEvents;
}

function toAuditQueryString(input: AuditEventsInput): string {
  const params = new URLSearchParams({ organizationId: input.organizationId });

  if (input.outcome) {
    params.set("outcome", input.outcome);
  }
  if (input.q?.trim()) {
    params.set("q", input.q.trim());
  }
  if (input.startMs !== undefined) {
    params.set("startMs", String(input.startMs));
  }

  return params.toString();
}

function getContentDispositionFilename(value: string | null): string | null {
  const match = value?.match(/filename="([^"]+)"/);
  return match?.[1] ?? null;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : null;
}

async function readAuditExportErrorMessage(response: Response): Promise<string> {
  const body = await response.text();
  if (!body.trim()) {
    return "Audit export failed.";
  }

  if (response.headers.get("Content-Type")?.includes("application/json")) {
    try {
      const parsed: unknown = JSON.parse(body);
      if (isJsonObject(parsed)) {
        return (
          readStringField(parsed, "error") ??
          readStringField(parsed, "message") ??
          "Audit export failed."
        );
      }
    } catch {
      return body;
    }
  }

  return body;
}

export async function exportAuditEvents(input: AuditEventsInput): Promise<{
  blob: Blob;
  filename: string | null;
}> {
  const response = await apiFetch(`/audit/export?${toAuditQueryString(input)}`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await readAuditExportErrorMessage(response));
  }

  return {
    blob: await response.blob(),
    filename: getContentDispositionFilename(response.headers.get("Content-Disposition")),
  };
}
