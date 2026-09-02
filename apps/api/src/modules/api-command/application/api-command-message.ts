import type { ApiCommandId } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";

export interface ApiCommandMessage {
  commandId: ApiCommandId;
  deliveryGeneration: number;
}

export function parseApiCommandMessage(value: unknown): ApiCommandMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("API command queue message must be an object.");
  }

  const commandId = (value as Record<string, unknown>)["commandId"];
  const deliveryGeneration = (value as Record<string, unknown>)["deliveryGeneration"];

  if (
    typeof deliveryGeneration !== "number" ||
    !Number.isSafeInteger(deliveryGeneration) ||
    deliveryGeneration <= 0
  ) {
    throw new Error(
      "API command queue message deliveryGeneration must be a positive safe integer.",
    );
  }

  return {
    commandId: parsePlatformId<ApiCommandId>(commandId, "API command queue message commandId"),
    deliveryGeneration,
  };
}
