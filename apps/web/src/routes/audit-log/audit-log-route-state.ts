import { AUDIT_RANGES } from "./audit-log-model";
import type { AuditOutcome, AuditRange } from "./audit-log-model";

export type AuditSearchParamKey = "eventId" | "outcome" | "q" | "range";

export function getAuditRange(value: string | null): AuditRange {
  return AUDIT_RANGES.includes(value as AuditRange) ? (value as AuditRange) : "7d";
}

export function getAuditOutcome(value: string | null): AuditOutcome {
  return value === "success" || value === "failure" || value === "denied" ? value : "all";
}
