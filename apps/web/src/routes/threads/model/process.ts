import type { SessionProcessEvent } from "@mosoo/contracts/session";

export type ThreadProcessEvent = SessionProcessEvent;
export type ThreadProcessVariant =
  | "Agent"
  | "Read"
  | "Tool"
  | "Web Fetch"
  | "Web Search"
  | "Write"
  | "exec_command";

function formatProcessValue(value: number | null, unit: "ms" | "tokens"): string {
  if (value === null) {
    return "unavailable";
  }

  return unit === "ms" ? `${value}ms` : `${value} tokens`;
}

function getToolVariant(content: string): ThreadProcessVariant {
  const lower = content.toLowerCase();

  if (lower.includes("exec_command") || lower.includes("bash") || lower.includes("shell")) {
    return "exec_command";
  }

  if (lower.includes("web_search") || lower.includes("web search") || lower.includes("websearch")) {
    return "Web Search";
  }

  if (lower.includes("web_fetch") || lower.includes("web fetch") || lower.includes("webfetch")) {
    return "Web Fetch";
  }

  if (lower.includes("read")) {
    return "Read";
  }

  if (lower.includes("write") || lower.includes("file")) {
    return "Write";
  }

  return "Tool";
}

export function getProcessEventVariant(event: ThreadProcessEvent): ThreadProcessVariant {
  switch (event.type) {
    case "agent.message.delta":
    case "agent.thinking.delta":
    case "run.completed":
    case "run.failed":
    case "run.started":
    case "session.status":
    case "usage.updated":
    case "user.message": {
      return "Agent";
    }
    case "file.changed":
    case "session_files.updated": {
      return "Write";
    }
    case "tool.confirmation.required":
    case "tool.use.completed":
    case "tool.use.started": {
      return getToolVariant(event.content);
    }
  }
}

export function createProcessCopyText(input: {
  agentName: string;
  events: readonly ThreadProcessEvent[];
}): string {
  return [
    `agent\t${input.agentName}`,
    "type\tstatus\ttokens\tduration\tcontent",
    ...input.events.map((event) =>
      [
        getProcessEventVariant(event),
        event.status,
        formatProcessValue(event.tokens, "tokens"),
        formatProcessValue(event.durationMs, "ms"),
        event.content.replaceAll(/\s+/g, " ").trim(),
      ].join("\t"),
    ),
  ].join("\n");
}
