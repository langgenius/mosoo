import type { PublicThreadUsageResponse } from "@mosoo/contracts/public-api";
import { sessionModelCallsTable } from "@mosoo/db";
import type { PublicThreadId, SessionModelCallId } from "@mosoo/id";
import { and, asc, eq, gt, sql } from "drizzle-orm";

import { getAppDatabase } from "../../platform/db/drizzle";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";
import { admitPublicSessionCaller } from "./public-thread-session-query.service";

export async function listPublicThreadUsage(input: {
  database: D1Database;
  caller: AuthenticatedViewer;
  threadId: PublicThreadId;
  after: SessionModelCallId | null;
  limit: number;
}): Promise<PublicThreadUsageResponse> {
  const { session } = await admitPublicSessionCaller(
    input.database,
    input.caller,
    input.threadId,
    "v2",
  );
  const rows = await getAppDatabase(input.database)
    .select({
      id: sessionModelCallsTable.id,
      runId: sessionModelCallsTable.sessionRunId,
      provider: sessionModelCallsTable.provider,
      model: sessionModelCallsTable.model,
      status: sessionModelCallsTable.status,
      inputTokens: sessionModelCallsTable.inputTokens,
      outputTokens: sessionModelCallsTable.outputTokens,
      cacheReadTokens: sessionModelCallsTable.cacheReadTokens,
      cacheCreationTokens: sessionModelCallsTable.cacheCreationTokens,
      reportedCostUsd: sql<
        number | null
      >`CASE WHEN ${sessionModelCallsTable.costCurrency} = 'USD' THEN ${sessionModelCallsTable.totalCostUsdMicros} / 1000000.0 ELSE NULL END`,
      usageContract: sql<
        string | null
      >`CASE WHEN json_valid(${sessionModelCallsTable.metadataJson}) AND json_type(${sessionModelCallsTable.metadataJson}, '$.usageContract') = 'text' THEN json_extract(${sessionModelCallsTable.metadataJson}, '$.usageContract') ELSE NULL END`,
    })
    .from(sessionModelCallsTable)
    .where(
      and(
        eq(sessionModelCallsTable.sessionId, session.id),
        input.after === null ? undefined : gt(sessionModelCallsTable.id, input.after),
      ),
    )
    .orderBy(asc(sessionModelCallsTable.id))
    .limit(input.limit + 1)
    .all();

  const usage = rows.slice(0, input.limit);
  return {
    usage,
    nextCursor: rows.length > input.limit ? (usage.at(-1)?.id ?? null) : null,
  };
}
