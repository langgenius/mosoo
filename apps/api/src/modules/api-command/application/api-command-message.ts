import type { ApiCommandId } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";

export interface ApiCommandMessage {
  commandId: ApiCommandId;
}

export function parseApiCommandMessage(value: unknown): ApiCommandMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("API command queue message must be an object.");
  }

  const commandId = (value as Record<string, unknown>)["commandId"];

  return {
    commandId: parsePlatformId<ApiCommandId>(commandId, "API command queue message commandId"),
  };
}
