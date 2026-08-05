import { isNoRuntimeEventsRecordedEventId } from "@mosoo/contracts/session";
import type {
  SessionProcessEvent,
  SessionProcessEventStatus,
  SessionProcessEventType,
} from "@mosoo/contracts/session";

export type SessionEventDomain = "agent" | "session" | "span" | "user";

export const SESSION_EVENT_FILTER_DOMAINS: SessionEventDomain[] = ["user", "agent", "session"];

export const SESSION_EVENT_DOMAIN_LABEL: Record<SessionEventDomain, string> = {
  agent: "agent",
  session: "session",
  span: "span",
  user: "user",
};

const SESSION_EVENT_DOMAIN_BY_TYPE = {
  "agent.message.delta": "agent",
  "agent.thinking.delta": "agent",
  "file.changed": "agent",
  "run.completed": "session",
  "run.failed": "session",
  "run.started": "session",
  "session.status": "session",
  "session_files.updated": "agent",
  "tool.confirmation.required": "agent",
  "tool.use.completed": "agent",
  "tool.use.started": "agent",
  "usage.updated": "span",
  "user.message": "user",
} as const satisfies Record<SessionProcessEventType, SessionEventDomain>;

export const SESSION_EVENT_TYPE_LABEL_KEY = {
  "agent.message.delta": "sessionEvents.eventAssistantMessage",
  "agent.thinking.delta": "sessionEvents.eventThinking",
  "file.changed": "sessionEvents.eventFileChanged",
  "run.completed": "sessionEvents.eventRunCompleted",
  "run.failed": "sessionEvents.eventRunFailed",
  "run.started": "sessionEvents.eventRunStarted",
  "session.status": "sessionEvents.eventSessionStatus",
  "session_files.updated": "sessionEvents.eventSessionFiles",
  "tool.confirmation.required": "sessionEvents.eventApprovalRequested",
  "tool.use.completed": "sessionEvents.eventToolResult",
  "tool.use.started": "sessionEvents.eventToolUse",
  "usage.updated": "sessionEvents.eventUsageUpdated",
  "user.message": "sessionEvents.eventUserMessage",
} as const satisfies Record<SessionProcessEventType, string>;

const SESSION_EVENT_DOMAIN_LABEL_KEY = {
  agent: "sessionEvents.domainAgent",
  session: "sessionEvents.domainSession",
  span: "sessionEvents.domainSpan",
  user: "sessionEvents.domainUser",
} as const satisfies Record<SessionEventDomain, string>;

type Translate = (key: string, variables?: Record<string, string>) => string;
const defaultTranslate: Translate = (key) => key;

export interface SessionEventDomainTone {
  bar: string;
  chip: string;
  row: string;
  swatch: string;
}

export const SESSION_EVENT_DOMAIN_TONE: Record<SessionEventDomain, SessionEventDomainTone> = {
  agent: {
    bar: "bg-green-600",
    chip: "border-green-200 bg-green-50 text-green-800",
    row: "hover:border-green-200 hover:bg-green-50/50",
    swatch: "bg-green-600",
  },
  session: {
    bar: "bg-ink-700",
    chip: "border-ink-200 bg-ink-50 text-ink-800",
    row: "hover:border-ink-200 hover:bg-ink-50/60",
    swatch: "bg-ink-700",
  },
  span: {
    bar: "bg-ink-400/75",
    chip: "border-ink-100 bg-ink-50 text-ink-600",
    row: "hover:border-ink-200 hover:bg-ink-50/60",
    swatch: "bg-ink-400/75",
  },
  user: {
    bar: "bg-sky",
    chip: "border-sky/30 bg-sky-bg text-sky-fg",
    row: "hover:border-sky/30 hover:bg-sky-bg/50",
    swatch: "bg-sky",
  },
};

const SESSION_EVENT_CHIP_TONE = {
  error: {
    bar: "bg-ember",
    chip: "border-ember/25 bg-ember-bg text-ember-fg",
    row: "hover:border-ember/25 hover:bg-ember-bg/50",
    swatch: "bg-ember",
  },
  exec: {
    bar: "bg-green-500",
    chip: "border-green-200 bg-green-50 text-green-800",
    row: "hover:border-green-200 hover:bg-green-50/50",
    swatch: "bg-green-500",
  },
  message: {
    bar: "bg-green-400",
    chip: "border-green-200 bg-green-50 text-green-800",
    row: "hover:border-green-200 hover:bg-green-50/50",
    swatch: "bg-green-400",
  },
  read: {
    bar: "bg-ink-300",
    chip: "border-ink-100 bg-ink-50 text-ink-700",
    row: "hover:border-ink-200 hover:bg-ink-50/60",
    swatch: "bg-ink-300",
  },
  result: {
    bar: "bg-ink-300",
    chip: "border-ink-100 bg-ink-50 text-ink-600",
    row: "hover:border-ink-200 hover:bg-ink-50/60",
    swatch: "bg-ink-300",
  },
  thinking: {
    bar: "bg-soil",
    chip: "border-soil/25 bg-soil-bg text-soil-fg",
    row: "hover:border-soil/25 hover:bg-soil-bg/50",
    swatch: "bg-soil",
  },
  tool: {
    bar: "bg-amber",
    chip: "border-amber/30 bg-amber-bg text-amber-fg",
    row: "hover:border-amber/30 hover:bg-amber-bg/50",
    swatch: "bg-amber",
  },
  userInput: {
    bar: "bg-sky",
    chip: "border-sky/30 bg-sky-bg text-sky-fg",
    row: "hover:border-sky/30 hover:bg-sky-bg/50",
    swatch: "bg-sky",
  },
  webFetch: {
    bar: "bg-sky/70",
    chip: "border-sky/25 bg-sky-bg text-sky-fg",
    row: "hover:border-sky/25 hover:bg-sky-bg/50",
    swatch: "bg-sky/70",
  },
  write: {
    bar: "bg-soil/80",
    chip: "border-soil/25 bg-soil-bg text-soil-fg",
    row: "hover:border-soil/25 hover:bg-soil-bg/50",
    swatch: "bg-soil/80",
  },
} as const satisfies Record<string, SessionEventDomainTone>;

function getToolChipTone(content: string): SessionEventDomainTone {
  const lower = content.toLowerCase();

  if (lower.includes("exec_command") || lower.includes("bash") || lower.includes("shell")) {
    return SESSION_EVENT_CHIP_TONE.exec;
  }

  if (lower.includes("web_fetch") || lower.includes("web fetch") || lower.includes("webfetch")) {
    return SESSION_EVENT_CHIP_TONE.webFetch;
  }

  if (lower.includes("web_search") || lower.includes("web search") || lower.includes("websearch")) {
    return SESSION_EVENT_CHIP_TONE.tool;
  }

  if (lower.includes("read")) {
    return SESSION_EVENT_CHIP_TONE.read;
  }

  if (lower.includes("write") || lower.includes("file")) {
    return SESSION_EVENT_CHIP_TONE.write;
  }

  return SESSION_EVENT_CHIP_TONE.tool;
}

export function getSessionEventDomain(type: SessionProcessEventType): SessionEventDomain {
  return SESSION_EVENT_DOMAIN_BY_TYPE[type];
}

export function getSessionEventLabel(
  type: SessionProcessEventType,
  t: Translate = defaultTranslate,
): string {
  return t(SESSION_EVENT_TYPE_LABEL_KEY[type]);
}

export function getSessionEventDomainLabel(
  domain: SessionEventDomain,
  t: Translate = defaultTranslate,
): string {
  return t(SESSION_EVENT_DOMAIN_LABEL_KEY[domain]);
}

export function getSessionEventChipTone(event: SessionProcessEvent): SessionEventDomainTone {
  if (event.status === "error" || event.type === "run.failed") {
    return SESSION_EVENT_CHIP_TONE.error;
  }

  switch (event.type) {
    case "agent.message.delta":
    case "run.completed":
    case "run.started":
    case "session.status": {
      return SESSION_EVENT_CHIP_TONE.message;
    }
    case "user.message": {
      return SESSION_EVENT_CHIP_TONE.userInput;
    }
    case "agent.thinking.delta": {
      return SESSION_EVENT_CHIP_TONE.thinking;
    }
    case "file.changed":
    case "session_files.updated": {
      return SESSION_EVENT_CHIP_TONE.write;
    }
    case "tool.confirmation.required":
    case "tool.use.started": {
      return getToolChipTone(event.content);
    }
    case "tool.use.completed": {
      return SESSION_EVENT_CHIP_TONE.result;
    }
    case "usage.updated": {
      return SESSION_EVENT_CHIP_TONE.result;
    }
  }
}

export function getSessionEventStatusLabel(
  status: SessionProcessEventStatus,
  t: Translate = defaultTranslate,
): string {
  switch (status) {
    case "available": {
      return t("sessionEvents.statusOk");
    }
    case "error": {
      return t("sessionEvents.statusError");
    }
    case "unsupported": {
      return t("sessionEvents.statusUnsupported");
    }
  }
}

export function isSessionStatusReschedulingEvent(event: SessionProcessEvent): boolean {
  return event.type === "session.status" && event.content === "mosoo.session.infra.rescheduling";
}

export function isSessionStatusRunningEvent(event: SessionProcessEvent): boolean {
  return event.type === "session.status" && event.content === "mosoo.session.infra.running";
}

export function isSessionStatusTerminatedEvent(event: SessionProcessEvent): boolean {
  return event.type === "session.status" && event.content === "mosoo.session.stopped";
}

export function isSessionEventAttentionWorthy(event: SessionProcessEvent): boolean {
  return (
    event.status !== "available" ||
    event.type === "run.failed" ||
    isSessionStatusReschedulingEvent(event) ||
    isSessionStatusTerminatedEvent(event)
  );
}

export function isSessionEventVisibleInMainFeed(event: SessionProcessEvent): boolean {
  return event.type !== "usage.updated" && !isSyntheticNoRuntimeEventsEvent(event);
}

export function summarizeSessionEvent(
  event: SessionProcessEvent,
  t: Translate = defaultTranslate,
): string {
  const normalized = event.content.replaceAll(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : getSessionEventLabel(event.type, t);
}

export function isSyntheticNoRuntimeEventsEvent(event: SessionProcessEvent): boolean {
  return isNoRuntimeEventsRecordedEventId(event.id);
}
