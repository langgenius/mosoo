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

type Translate = (key: string, variables?: Record<string, string>) => string;

export function selectCurrentAgentTasks<T>(input: {
  currentRunId: string | null;
  snapshot: { runId: string; tasks: readonly T[] } | null;
  threadWorking: boolean;
}): readonly T[] {
  return input.threadWorking && input.snapshot?.runId === input.currentRunId
    ? input.snapshot.tasks
    : [];
}

function formatProcessValue(
  value: number | null,
  unit: "ms" | "tokens",
  t: Translate = (key) => key,
): string {
  if (value === null) {
    return t("threads.unavailable");
  }

  return unit === "ms" ? `${value}ms` : `${value} ${t("threads.tokens")}`;
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

export function createProcessCopyText(
  input: {
    agentName: string;
    events: readonly ThreadProcessEvent[];
  },
  t: Translate = (key) => key,
): string {
  return [
    `${t("threads.copyAgent")}\t${input.agentName}`,
    `${t("threads.copyType")}\t${t("threads.copyStatus")}\t${t("threads.copyTokens")}\t${t("threads.copyDuration")}\t${t("threads.copyContent")}`,
    ...input.events.map((event) =>
      [
        getProcessEventVariant(event),
        event.status,
        formatProcessValue(event.tokens, "tokens", t),
        formatProcessValue(event.durationMs, "ms", t),
        event.content.replaceAll(/\s+/g, " ").trim(),
      ].join("\t"),
    ),
  ].join("\n");
}
