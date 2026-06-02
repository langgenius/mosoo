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

const SESSION_EVENT_TYPE_LABEL = {
  "agent.message.delta": "Assistant message",
  "agent.thinking.delta": "Thinking",
  "file.changed": "File changed",
  "run.completed": "Run completed",
  "run.failed": "Run failed",
  "run.started": "Run started",
  "session.status": "Session status",
  "session_files.updated": "Session files",
  "tool.confirmation.required": "Approval requested",
  "tool.use.completed": "Tool result",
  "tool.use.started": "Tool use",
  "usage.updated": "Usage updated",
  "user.message": "User input",
} as const satisfies Record<SessionProcessEventType, string>;

export interface SessionEventDomainTone {
  bar: string;
  chip: string;
  row: string;
  swatch: string;
}

export const SESSION_EVENT_DOMAIN_TONE: Record<SessionEventDomain, SessionEventDomainTone> = {
  agent: {
    bar: "bg-purple-700/65",
    chip: "border-purple-200 bg-purple-50 text-purple-800",
    row: "hover:border-violet-200 hover:bg-violet-50/40",
    swatch: "bg-purple-700/65",
  },
  session: {
    bar: "bg-emerald-700/65",
    chip: "border-emerald-200 bg-emerald-50 text-emerald-800",
    row: "hover:border-emerald-200 hover:bg-emerald-50/40",
    swatch: "bg-emerald-700/65",
  },
  span: {
    bar: "bg-zinc-500/70",
    chip: "border-zinc-200 bg-zinc-50 text-zinc-700",
    row: "hover:border-zinc-300 hover:bg-zinc-50/60",
    swatch: "bg-zinc-500/70",
  },
  user: {
    bar: "bg-blue-700/65",
    chip: "border-blue-200 bg-blue-50 text-blue-800",
    row: "hover:border-blue-200 hover:bg-blue-50/40",
    swatch: "bg-blue-700/65",
  },
};

const SESSION_EVENT_CHIP_TONE = {
  error: {
    bar: "bg-red-400",
    chip: "border-red-200 bg-red-50 text-red-700",
    row: "hover:border-red-200 hover:bg-red-50/40",
    swatch: "bg-red-400",
  },
  exec: {
    bar: "bg-emerald-300",
    chip: "border-emerald-200 bg-emerald-50 text-emerald-800",
    row: "hover:border-emerald-200 hover:bg-emerald-50/40",
    swatch: "bg-emerald-300",
  },
  message: {
    bar: "bg-emerald-400",
    chip: "border-emerald-200 bg-emerald-50 text-emerald-800",
    row: "hover:border-emerald-200 hover:bg-emerald-50/40",
    swatch: "bg-emerald-400",
  },
  read: {
    bar: "bg-teal-300",
    chip: "border-teal-200 bg-teal-50 text-teal-800",
    row: "hover:border-teal-200 hover:bg-teal-50/40",
    swatch: "bg-teal-300",
  },
  result: {
    bar: "bg-slate-300",
    chip: "border-slate-200 bg-slate-50 text-slate-700",
    row: "hover:border-slate-200 hover:bg-slate-50/50",
    swatch: "bg-slate-300",
  },
  thinking: {
    bar: "bg-violet-400",
    chip: "border-violet-200 bg-violet-50 text-violet-800",
    row: "hover:border-violet-200 hover:bg-violet-50/40",
    swatch: "bg-violet-400",
  },
  tool: {
    bar: "bg-amber-300",
    chip: "border-amber-200 bg-amber-50 text-amber-800",
    row: "hover:border-amber-200 hover:bg-amber-50/40",
    swatch: "bg-amber-300",
  },
  userInput: {
    bar: "bg-blue-400",
    chip: "border-blue-200 bg-blue-50 text-blue-800",
    row: "hover:border-blue-200 hover:bg-blue-50/40",
    swatch: "bg-blue-400",
  },
  webFetch: {
    bar: "bg-sky-300",
    chip: "border-sky-200 bg-sky-50 text-sky-800",
    row: "hover:border-sky-200 hover:bg-sky-50/40",
    swatch: "bg-sky-300",
  },
  write: {
    bar: "bg-orange-300",
    chip: "border-orange-200 bg-orange-50 text-orange-800",
    row: "hover:border-orange-200 hover:bg-orange-50/40",
    swatch: "bg-orange-300",
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

export function getSessionEventLabel(type: SessionProcessEventType): string {
  return SESSION_EVENT_TYPE_LABEL[type];
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

export function getSessionEventStatusLabel(status: SessionProcessEventStatus): string {
  switch (status) {
    case "available": {
      return "ok";
    }
    case "error": {
      return "error";
    }
    case "unsupported": {
      return "unsupported";
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

export function summarizeSessionEvent(event: SessionProcessEvent): string {
  const normalized = event.content.replaceAll(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : getSessionEventLabel(event.type);
}

export function isSyntheticNoRuntimeEventsEvent(event: SessionProcessEvent): boolean {
  return event.id.endsWith(":process-events:not-recorded");
}
