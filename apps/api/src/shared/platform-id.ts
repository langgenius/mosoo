import { parsePlatformId } from "@mosoo/id";
import type { PlatformId } from "@mosoo/id";

interface ToPlatformId {
  <TId extends PlatformId = PlatformId>(
    value: string,
    label: string,
    narrow?: (id: PlatformId) => TId,
  ): TId;
}

interface ToNullablePlatformId {
  <TId extends PlatformId = PlatformId>(
    value: string | null | undefined,
    label: string,
    narrow?: (id: PlatformId) => TId,
  ): TId | null;
}

function toPlatformIdValue(value: string, label: string): PlatformId {
  return parsePlatformId(value, label);
}

function toNullablePlatformIdValue(
  value: string | null | undefined,
  label: string,
): PlatformId | null {
  return value == null ? null : toPlatformIdValue(value, label);
}

export const toPlatformId = toPlatformIdValue as ToPlatformId;
export const toNullablePlatformId = toNullablePlatformIdValue as ToNullablePlatformId;
