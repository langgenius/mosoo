import type { AgentBuilderVisibleAssetBindingState } from "@mosoo/contracts/agent-builder";

import type { HashableAssetSummary } from "./agent-builder-visible-assets.types";

export function normalizeUnique<TValue extends string>(values: readonly TValue[]): TValue[] {
  return [...new Set(values.filter((value) => value.length > 0))].toSorted();
}

export function compareByNameThenId(
  left: { id: string; name: string },
  right: { id: string; name: string },
): number {
  const nameOrder = left.name.localeCompare(right.name);
  return nameOrder === 0 ? left.id.localeCompare(right.id) : nameOrder;
}

function hashText(text: string): string {
  let hash = 0x81_1c_9d_c5;

  for (const character of text) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01_00_01_93);
  }

  const unsignedHash = hash < 0 ? hash + 0x01_00_00_00_00 : hash;
  return Math.trunc(unsignedHash).toString(16).padStart(8, "0");
}

export function hashRecord(value: unknown): string {
  return hashText(JSON.stringify(value));
}

export function readUrlHost(url: string): string {
  return URL.canParse(url) ? new URL(url).host : "invalid-url";
}

export function toBindingState(
  id: string,
  boundIds: ReadonlySet<string>,
  represented = true,
): AgentBuilderVisibleAssetBindingState {
  if (!represented) {
    return "not_represented";
  }

  return boundIds.has(id) ? "bound" : "not_bound";
}

export function withHash<TAsset extends Omit<HashableAssetSummary, "hash">>(
  asset: TAsset,
): TAsset & {
  hash: string;
} {
  return {
    ...asset,
    hash: hashRecord(asset),
  };
}
