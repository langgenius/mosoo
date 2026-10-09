import type { SessionProcessEvent } from "@mosoo/contracts/session";

import { getCurrentLocale } from "@/shared/i18n";

import { getSessionEventDomain, summarizeSessionEvent } from "./domain";
import { formatDuration, formatTokens } from "./format";
import type { SessionTurnStatus } from "./turns";

const MAX_PREVIEW_LENGTH = 180;

export function formatEventTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(getCurrentLocale(), {
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
      return "border-border bg-sunken/40 text-fg-3";
    }
    case "error": {
      return "border-danger/25 bg-danger-bg text-danger-fg";
    }
    case "unsupported": {
      return "border-warning/30 bg-warning-bg text-warning-fg";
    }
  }
}

export function turnStatusClassName(status: SessionTurnStatus): string {
  switch (status) {
    case "completed": {
      return "border-success/25 bg-success-bg text-success-fg";
    }
    case "failed": {
      return "border-danger/25 bg-danger-bg text-danger-fg";
    }
    case "pending": {
      return "border-border bg-sunken/50 text-fg-3";
    }
    case "rescheduling": {
      return "border-warning/30 bg-warning-bg text-warning-fg";
    }
    case "running": {
      return "border-info/30 bg-info-bg text-info-fg";
    }
    case "terminated": {
      return "border-danger/25 bg-danger-bg text-danger-fg";
    }
  }
}

type Translate = (key: string, variables?: Record<string, string>) => string;

export function turnStatusLabel(status: SessionTurnStatus, t: Translate): string {
  switch (status) {
    case "completed": {
      return t("threads.completed");
    }
    case "failed": {
      return t("threads.failed");
    }
    case "pending": {
      return t("sessionEvents.turnStatusPending");
    }
    case "rescheduling": {
      return t("sessionEvents.turnStatusReconnecting");
    }
    case "running": {
      return t("sessionEvents.turnStatusRunning");
    }
    case "terminated": {
      return t("sessionEvents.turnStatusTerminated");
    }
  }
}

export function createSessionEventCopyText(
  input: {
    events: readonly SessionProcessEvent[];
    title: string;
  },
  t: Translate,
): string {
  return [
    input.title,
    "type\tdomain\tstatus\ttokens\tduration\tcontent",
    ...input.events.map((event) =>
      [
        event.type,
        getSessionEventDomain(event.type),
        event.status,
        formatTokens(event.tokens),
        formatDuration(event.durationMs),
        summarizeSessionEvent(event, t),
      ].join("\t"),
    ),
  ].join("\n");
}
