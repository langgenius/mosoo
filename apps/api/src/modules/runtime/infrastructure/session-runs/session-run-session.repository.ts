import { sessionsTable } from "@mosoo/db";
import type { SessionId, SessionRunId } from "@mosoo/id";
import { and, eq, isNull, sql } from "drizzle-orm";

import { getAppDatabase, getD1ChangeCount } from "../../../../platform/db/drizzle";
import { createSessionStatusTransitionPatch } from "./session-lifecycle-projection.repository";

interface UpdateSessionLastRunInput {
  model: string | null;
  provider: string | null;
  runId: SessionRunId;
  sessionId: SessionId;
  timestampMs: number;
}

export async function updateSessionLastRun(
  database: D1Database,
  input: UpdateSessionLastRunInput,
): Promise<boolean> {
  const result = await getAppDatabase(database)
    .update(sessionsTable)
    .set({
      lastRunId: input.runId,
      model: sql`COALESCE(${input.model}, ${sessionsTable.model})`,
      provider: sql`COALESCE(${input.provider}, ${sessionsTable.provider})`,
      ...createSessionStatusTransitionPatch({
        status: "RUNNING",
        timestampMs: input.timestampMs,
      }),
    })
    .where(
      and(
        eq(sessionsTable.id, input.sessionId),
        isNull(sessionsTable.archivedAt),
        eq(sessionsTable.status, "IDLE"),
        isNull(sessionsTable.statusOperationId),
      ),
    )
    .run();

  return getD1ChangeCount(result) > 0;
}
