import { SESSION_SYSTEM_LOG_EVENT_FAMILIES } from "@mosoo/contracts/session";

import type { AgentRuntimeEvent } from "@/domains/session/api/agent-runtime-events";
import type { AgentRuntimeEventFamily } from "@/gql/graphql";

export const SYSTEM_LOG_PAGE_SIZE = 200;
export const SYSTEM_LOG_POLLING_INTERVAL_MS = 2500;
export const SYSTEM_LOG_BOTTOM_STICKY_THRESHOLD_PX = 96;

export const SYSTEM_LOG_RUNTIME_EVENT_FAMILIES =
  SESSION_SYSTEM_LOG_EVENT_FAMILIES satisfies readonly AgentRuntimeEventFamily[];

export const SYSTEM_LOG_RUNTIME_EVENT_FAMILY_OPTIONS: {
  label: string;
  value: AgentRuntimeEventFamily;
}[] = SYSTEM_LOG_RUNTIME_EVENT_FAMILIES.map((family) => ({
  label: family,
  value: family,
}));

export interface SystemLogPagination {
  hasMoreOlder: boolean;
  olderCursor: string | null;
}

export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) {
    return `${Math.max(1, Math.floor(diff / 1000))}s ago`;
  }
  if (diff < hour) {
    return `${Math.floor(diff / minute)}m ago`;
  }
  if (diff < day) {
    return `${Math.floor(diff / hour)}h ago`;
  }
  if (diff < 7 * day) {
    return `${Math.floor(diff / day)}d ago`;
  }

  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function formatEventTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    second: "2-digit",
  });
}

function compareEventsDesc(left: AgentRuntimeEvent, right: AgentRuntimeEvent): number {
  const createdDelta = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();

  if (createdDelta !== 0) {
    return createdDelta;
  }

  return right.id.localeCompare(left.id);
}

export function mergeRuntimeEvents(
  currentEvents: AgentRuntimeEvent[],
  incomingEvents: AgentRuntimeEvent[],
): AgentRuntimeEvent[] {
  const byId = new Map<string, AgentRuntimeEvent>();

  for (const event of currentEvents) {
    byId.set(event.id, event);
  }
  for (const event of incomingEvents) {
    byId.set(event.id, event);
  }

  return [...byId.values()].toSorted(compareEventsDesc);
}

export function shortSessionId(sessionId: string): string {
  return sessionId.length > 12 ? `${sessionId.slice(0, 8)}...${sessionId.slice(-4)}` : sessionId;
}

export function familyBadgeClass(family: AgentRuntimeEvent["family"]): string {
  switch (family) {
    case "diagnostics":
    case "resource":
    case "state":
    case "usage": {
      return "border-ink-200 bg-ink-50 text-ink-700";
    }
    case "config": {
      return "border-soil/25 bg-soil-bg text-soil-fg";
    }
    case "driver":
    case "permission":
    case "tool": {
      return "border-amber/30 bg-amber-bg text-amber-fg";
    }
    case "file":
    case "input":
    case "provisioning":
    case "transport": {
      return "border-sky/30 bg-sky-bg text-sky-fg";
    }
    case "lifecycle":
    case "run":
    case "sandbox": {
      return "border-green-200 bg-success-bg text-success-fg";
    }
    case "message": {
      return "border-green-200 bg-green-50 text-green-800";
    }
    default: {
      return "border-ink-200 bg-ink-50 text-ink-700";
    }
  }
}

export function formatFamilyFilterLabel(
  selectedFamilies: ReadonlySet<AgentRuntimeEventFamily>,
): string {
  if (selectedFamilies.size === SYSTEM_LOG_RUNTIME_EVENT_FAMILIES.length) {
    return "All families";
  }

  if (selectedFamilies.size === 0) {
    return "No families";
  }

  if (selectedFamilies.size === 1) {
    return [...selectedFamilies][0] ?? "1 family";
  }

  return `${selectedFamilies.size} families`;
}
