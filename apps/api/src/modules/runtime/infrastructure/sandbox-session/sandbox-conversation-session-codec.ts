import { SpaceAliasBinding } from "@mosoo/contracts/sandbox";
import type { SpaceAliasBinding as SpaceAliasBindingValue } from "@mosoo/contracts/sandbox";
import { parseSchemaValue } from "@mosoo/contracts/validation";
import { DriverOrigin } from "@mosoo/driver-protocol";
import type { DriverOrigin as DriverOriginValue } from "@mosoo/driver-protocol";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, SpaceId } from "@mosoo/id";

const SpaceAliasBindingList = SpaceAliasBinding.array();

export function parseSandboxConversationOrigin(raw: string): DriverOriginValue {
  const origin = parseSchemaValue(DriverOrigin, JSON.parse(raw));

  return {
    ...origin,
    callerUserId: parsePlatformId<AccountId>(origin.callerUserId, "sandbox origin caller user id"),
    executionOwnerUserId: parsePlatformId<AccountId>(
      origin.executionOwnerUserId,
      "sandbox origin execution owner user id",
    ),
  };
}

export function parseSandboxConversationSpaceAliases(raw: string): SpaceAliasBindingValue[] {
  return parseSchemaValue(SpaceAliasBindingList, JSON.parse(raw)).map((alias) =>
    Object.assign(alias, {
      spaceId: parsePlatformId<SpaceId>(alias.spaceId, "sandbox space alias space id"),
    }),
  );
}
