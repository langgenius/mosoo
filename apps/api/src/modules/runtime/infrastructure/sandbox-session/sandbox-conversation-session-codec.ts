import { SpaceAliasBinding } from "@mosoo/contracts/sandbox";
import type { SpaceAliasBinding as SpaceAliasBindingValue } from "@mosoo/contracts/sandbox";
import { parseSchemaValue } from "@mosoo/contracts/validation";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, SpaceId } from "@mosoo/id";

import type { DriverOrigin as DriverOriginValue } from "../../domain/driver-snapshot";

const SpaceAliasBindingList = SpaceAliasBinding.array();

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

export function parseSandboxConversationSpaceAliases(raw: string): SpaceAliasBindingValue[] {
  return parseSchemaValue(SpaceAliasBindingList, JSON.parse(raw)).map((alias) =>
    Object.assign(alias, {
      spaceId: parsePlatformId<SpaceId>(alias.spaceId, "sandbox space alias space id"),
    }),
  );
}
