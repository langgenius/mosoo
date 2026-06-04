import type { SessionProcessEvent } from "@mosoo/contracts/session";

import { getSessionEventDomain, summarizeSessionEvent } from "./domain";
import { formatDuration, formatTokens } from "./format";
import type { SessionTurnStatus } from "./turns";

const MAX_PREVIEW_LENGTH = 180;

export function formatEventTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function clipPreview(content: string): string {
  const normalized = content.replaceAll(/\s+/g, " ").trim();

  if (normalized.length <= MAX_PREVIEW_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_PREVIEW_LENGTH - 3)}...`;
}

export function statusClassName(status: SessionProcessEvent["status"]): string {
  switch (status) {
    case "available": {
      return "border-border bg-muted/40 text-fg-3";
    }
    case "error": {
      return "border-ember/25 bg-ember-bg text-ember-fg";
    }
    case "unsupported": {
      return "border-amber/30 bg-amber-bg text-amber-fg";
    }
  }
}

export function turnStatusClassName(status: SessionTurnStatus): string {
  switch (status) {
    case "completed": {
      return "border-green-200 bg-green-50 text-green-800";
    }
    case "failed": {
      return "border-ember/25 bg-ember-bg text-ember-fg";
    }
    case "pending": {
      return "border-border bg-muted/50 text-fg-3";
    }
    case "rescheduling": {
      return "border-amber/30 bg-amber-bg text-amber-fg";
    }
    case "running": {
      return "border-sky/30 bg-sky-bg text-sky-fg";
    }
    case "terminated": {
      return "border-ember/25 bg-ember-bg text-ember-fg";
    }
  }
}

export function turnStatusLabel(status: SessionTurnStatus): string {
  switch (status) {
    case "completed": {
      return "Completed";
    }
    case "failed": {
      return "Failed";
    }
    case "pending": {
      return "Pending";
    }
    case "rescheduling": {
      return "Reconnecting";
    }
    case "running": {
      return "Running";
    }
    case "terminated": {
      return "Terminated";
    }
  }
}

export function createSessionEventCopyText(input: {
  events: readonly SessionProcessEvent[];
  title: string;
}): string {
  return [
    `turn\t${input.title}`,
    "type\tdomain\tstatus\ttokens\tduration\tcontent",
    ...input.events.map((event) =>
      [
        event.type,
        getSessionEventDomain(event.type),
        event.status,
        formatTokens(event.tokens),
        formatDuration(event.durationMs),
        summarizeSessionEvent(event),
      ].join("\t"),
    ),
  ].join("\n");
}
