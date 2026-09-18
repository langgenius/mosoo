import type { PublicThreadRunSummary } from "@mosoo/contracts/public-api";
import { sessionRunBudgetsTable } from "@mosoo/db";
import { eq } from "drizzle-orm";

import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../platform/db/drizzle";
import { PublicApiError, publicInvalidRequest } from "./public-api-errors";

export function parseTurnBudgetUsd(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    !Number.isSafeInteger(Math.round(value * 1_000_000)) ||
    Math.round(value * 1_000_000) < 1 ||
    Math.abs(value * 1_000_000 - Math.round(value * 1_000_000)) > 0.000001
  ) {
    throw publicInvalidRequest(
      "maxCostUsd must be a positive USD amount with at most six decimal places.",
    );
  }
  return value;
}

export function resolvePublicThreadTurnBudget(
  bindings: ApiBindings,
  requested: number | undefined,
): number | null {
  const value = bindings.MOSOO_TURN_BUDGET_POLICY;
  if (!value) {
    if (requested !== undefined)
      throw new PublicApiError({
        code: "readiness_blocked",
        status: 409,
        message: "Turn budgets are not configured on this deployment.",
      });
    return null;
  }
  let policy: unknown;
  try {
    policy = JSON.parse(value);
  } catch {
    throw new Error("Invalid platform turn budget policy.");
  }
  if (
    typeof policy !== "object" ||
    policy === null ||
    !("defaultUsd" in policy) ||
    !("maxUsd" in policy)
  )
    throw new Error("Invalid platform turn budget policy.");
  let defaultUsd: number | undefined;
  let maxUsd: number | undefined;
  try {
    defaultUsd = parseTurnBudgetUsd(policy.defaultUsd);
    maxUsd = parseTurnBudgetUsd(policy.maxUsd);
  } catch {
    throw new Error("Invalid platform turn budget policy.");
  }
  if (defaultUsd === undefined || maxUsd === undefined || defaultUsd > maxUsd)
    throw new Error("Invalid platform turn budget policy.");
  const selected = parseTurnBudgetUsd(requested) ?? defaultUsd;
  if (selected > maxUsd)
    throw publicInvalidRequest(`maxCostUsd exceeds the platform limit of ${maxUsd} USD.`);
  return Math.round(selected * 1_000_000);
}

export async function withPublicRunBudget(
  database: D1Database,
  run: PublicThreadRunSummary | null,
): Promise<PublicThreadRunSummary | null> {
  if (run === null) return null;
  const row = await getAppDatabase(database)
    .select()
    .from(sessionRunBudgetsTable)
    .where(eq(sessionRunBudgetsTable.sessionRunId, run.id))
    .get();
  if (!row) return run;
  return {
    ...run,
    budget: {
      capUsd: row.capUsdMicros / 1_000_000,
      estimatedCostUsd: row.estimatedCostUsdMicros / 1_000_000,
      state: row.blockedReason ?? (row.activeRequestId === null ? "available" : "settling"),
    },
  };
}
