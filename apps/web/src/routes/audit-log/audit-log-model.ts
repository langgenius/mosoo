export type AuditRange = "24h" | "7d" | "30d";
export type AuditOutcome = "all" | "success" | "failure" | "denied";
export const AUDIT_RANGES = ["24h", "7d", "30d"] as const;

export function formatRelativeTime(timestamp: string): string {
  const diff = Math.max(0, Date.now() - new Date(timestamp).getTime());
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) {
    return "just now";
  }
  if (diff < hour) {
    return `${Math.floor(diff / minute)}m ago`;
  }
  if (diff < day) {
    return `${Math.floor(diff / hour)}h ago`;
  }
  return `${Math.floor(diff / day)}d ago`;
}

export function getRangeStart(range: AuditRange): number {
  const hours = range === "24h" ? 24 : range === "7d" ? 24 * 7 : 24 * 30;
  return Date.now() - hours * 60 * 60 * 1000;
}

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatAuditCsvFilename(date = new Date()): string {
  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  const hour = padDatePart(date.getHours());
  const minute = padDatePart(date.getMinutes());
  return `audit-events-${year}${month}${day}${hour}${minute}.csv`;
}

export function getCategory(action: string): string {
  return action.split(".")[0] ?? action;
}
