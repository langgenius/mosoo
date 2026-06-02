import type { DriverEventInput } from "@mosoo/driver-protocol";

import {
  isRecord,
  readArray,
  readNonEmptyString,
  readRecord,
  readString,
  stringifyForDisplay,
} from "./app-server-json";
import type { JsonObject } from "./app-server-json";

export function toOpenAiToolName(item: JsonObject): string | null {
  const itemType = readString(item, "type");

  if (itemType === "commandExecution") {
    return "Shell";
  }

  if (itemType === "fileChange") {
    return "File change";
  }

  if (itemType === "mcpToolCall") {
    const server = readNonEmptyString(item, "server");
    const tool = readNonEmptyString(item, "tool");

    if (server !== null && tool !== null) {
      return `${server}.${tool}`;
    }

    return tool ?? "MCP tool";
  }

  if (itemType === "dynamicToolCall") {
    return readString(item, "tool") ?? "Tool";
  }

  if (itemType === "webSearch") {
    return "Web search";
  }

  return null;
}

export function toOpenAiToolResultText(item: JsonObject): string | null {
  const itemType = readString(item, "type");

  if (itemType === "commandExecution") {
    return readString(item, "aggregatedOutput");
  }

  if (itemType === "fileChange") {
    const changes = readArray(item, "changes");
    if (changes.length === 0) {
      return null;
    }

    return changes
      .map((change) => {
        if (!isRecord(change)) {
          return null;
        }

        const path = readNonEmptyString(change, "path");
        const diff = readNonEmptyString(change, "diff");
        return [path, diff]
          .filter((entry): entry is string => entry !== null && entry.length > 0)
          .join("\n");
      })
      .filter((entry): entry is string => entry !== null && entry.length > 0)
      .join("\n\n");
  }

  if (itemType === "mcpToolCall") {
    const error = readRecord(item, "error");
    if (error !== null) {
      return readString(error, "message") ?? "MCP tool failed.";
    }

    return stringifyForDisplay(item["result"]);
  }

  if (itemType === "dynamicToolCall") {
    return stringifyForDisplay(item["contentItems"] ?? item["success"]);
  }

  if (itemType === "webSearch") {
    return readString(item, "query");
  }

  return null;
}

export function toOpenAiFileChangeEvents(item: JsonObject): DriverEventInput[] {
  if (readString(item, "type") !== "fileChange") {
    return [];
  }

  return readArray(item, "changes").flatMap((change) => {
    if (!isRecord(change)) {
      return [];
    }

    const path = readNonEmptyString(change, "path");
    const kind = readRecord(change, "kind");
    const changeType = readString(kind, "type");

    if (path === null) {
      return [];
    }

    return [
      {
        actor: "tool",
        kind: "file.change.updated",
        origin: "file",
        payload: {
          changes: [
            {
              change: changeType === "delete" ? "delete" : "upsert",
              path,
            },
          ],
          status: "completed",
        },
      },
    ] satisfies DriverEventInput[];
  });
}
