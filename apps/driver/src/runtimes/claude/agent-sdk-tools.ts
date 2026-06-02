import { isTruthy } from "../../core/truthiness";
import { readString, stringifyForDisplay } from "./agent-sdk-json";
import type { JsonObject } from "./agent-sdk-json";
export function isToolUseBlock(block: JsonObject): boolean {
  const type = readString(block, "type");
  return type === "tool_use" || type === "mcp_tool_use" || type === "server_tool_use";
}

export function toToolCallId(block: JsonObject, messageId: string, index: number): string {
  return readString(block, "id") ?? `${messageId}:tool:${index}`;
}

export function toToolCallName(block: JsonObject): string {
  const type = readString(block, "type");
  const name = readString(block, "name") ?? "Tool";

  if (type === "mcp_tool_use") {
    const serverName = readString(block, "server_name");
    return isTruthy(serverName) ? `${serverName}.${name}` : name;
  }

  return name;
}

export function toToolResultText(block: JsonObject): string | null {
  if (readString(block, "type") !== "tool_result") {
    return null;
  }

  return stringifyForDisplay(block["content"]);
}
