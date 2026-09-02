export type StoredToolStatus = "cancelled" | "completed" | "failed" | "running";

function normalizeToolResult(value: string): string {
  const normalized = value.replaceAll(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : value;
}

export function formatStoredSessionEventContent(input: {
  contentText: string;
  eventType: string;
  toolName?: string | null;
  toolStatus?: StoredToolStatus | null;
}): string {
  if (input.eventType === "session.commands.updated") {
    return "Session commands updated.";
  }
  if (input.eventType === "usage.updated") {
    return "Usage updated.";
  }
  if (input.eventType !== "tool.call.updated" || input.toolStatus == null) {
    return input.contentText;
  }

  const name = input.toolName ?? "Tool";

  if (input.toolStatus === "running" || input.toolStatus === "cancelled") {
    return name;
  }

  if (input.contentText.length > 0) {
    return `${name} result: ${normalizeToolResult(input.contentText)}`;
  }

  return input.toolStatus === "failed" ? `${name} failed.` : `${name} completed.`;
}
