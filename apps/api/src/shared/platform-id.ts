import { parsePlatformId } from "@mosoo/id";
import type { PlatformId } from "@mosoo/id";

interface ToPlatformId {
  <TId extends PlatformId = PlatformId>(
    value: string,
    label: string,
    narrow?: (id: PlatformId) => TId,
  ): TId;
}

function toPlatformIdValue(value: string, label: string): PlatformId {
  return parsePlatformId(value, label);
}

export const toPlatformId = toPlatformIdValue as ToPlatformId;
