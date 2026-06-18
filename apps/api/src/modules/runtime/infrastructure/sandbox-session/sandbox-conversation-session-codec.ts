import { parsePlatformId } from "@mosoo/id";
import type { AccountId } from "@mosoo/id";

import type { DriverOrigin as DriverOriginValue } from "../../domain/driver-snapshot";

function readSandboxConversationOriginRecord(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Sandbox conversation origin must be an object.");
  }

  return parsed as Record<string, unknown>;
}

function readSandboxOriginEntryPoint(value: unknown): DriverOriginValue["entrypoint"] {
  if (value === "api" || value === "chat") {
    return value;
  }

  throw new Error("Sandbox conversation origin entrypoint is invalid.");
}

function readSandboxOriginType(value: unknown): DriverOriginValue["type"] {
  if (value === "agent") {
    return value;
  }

  throw new Error("Sandbox conversation origin type is invalid.");
}

export function parseSandboxConversationOrigin(raw: string): DriverOriginValue {
  const origin = readSandboxConversationOriginRecord(raw);

  return {
    callerUserId: parsePlatformId<AccountId>(
      origin["callerUserId"],
      "sandbox origin caller user id",
    ),
    entrypoint: readSandboxOriginEntryPoint(origin["entrypoint"]),
    executionOwnerUserId: parsePlatformId<AccountId>(
      origin["executionOwnerUserId"],
      "sandbox origin execution owner user id",
    ),
    type: readSandboxOriginType(origin["type"]),
  };
}
