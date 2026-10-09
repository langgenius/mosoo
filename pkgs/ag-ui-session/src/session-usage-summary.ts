import { parseSchemaValue } from "@mosoo/contracts/validation";

import type { SessionUsageSummary } from "./live-state";
import { SessionUsageSummarySchema } from "./session-live-state-schema";

const StrictSessionUsageSummarySchema = SessionUsageSummarySchema.onDeepUndeclaredKey("delete");

export function parseNullableSessionUsageSummary(value: unknown): SessionUsageSummary | null {
  if (value === null || value === undefined) {
    return null;
  }

  return parseSchemaValue(StrictSessionUsageSummarySchema, value);
}

export function readSessionUsageTokenTotal(
  usage: SessionUsageSummary | null | undefined,
): number | null {
  return usage?.totalTokens ?? usage?.used ?? usage?.size ?? null;
}
