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
    case "diagnostics": {
      return "border-slate-200 bg-slate-50 text-slate-700";
    }
    case "config": {
      return "border-rose-200 bg-rose-50 text-rose-700";
    }
    case "driver": {
      return "border-amber-200 bg-amber-50 text-amber-800";
    }
    case "file": {
      return "border-sky-200 bg-sky-50 text-sky-700";
    }
    case "input": {
      return "border-indigo-200 bg-indigo-50 text-indigo-700";
    }
    case "lifecycle": {
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    }
    case "message": {
      return "border-violet-200 bg-violet-50 text-violet-700";
    }
    case "permission": {
      return "border-amber-200 bg-amber-50 text-amber-800";
    }
    case "provisioning": {
      return "border-indigo-200 bg-indigo-50 text-indigo-700";
    }
    case "resource": {
      return "border-stone-200 bg-stone-50 text-stone-700";
    }
    case "run": {
      return "border-blue-200 bg-blue-50 text-blue-700";
    }
    case "sandbox": {
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    }
    case "state": {
      return "border-teal-200 bg-teal-50 text-teal-700";
    }
    case "tool": {
      return "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700";
    }
    case "transport": {
      return "border-cyan-200 bg-cyan-50 text-cyan-700";
    }
    case "usage": {
      return "border-lime-200 bg-lime-50 text-lime-800";
    }
    default: {
      return "border-slate-200 bg-slate-50 text-slate-700";
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
