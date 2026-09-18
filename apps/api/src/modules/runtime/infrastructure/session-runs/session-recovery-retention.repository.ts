import { sessionExecutionSnapshotsTable, sessionRunsTable, sessionsTable } from "@mosoo/db";
import type { SessionId } from "@mosoo/id";
import { and, eq, lte, notExists, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../../platform/db/drizzle";
import type { AppDatabase } from "../../../../platform/db/drizzle";

function recoveryExpiresAt(sessionId: SessionId | typeof sessionsTable.id) {
  // No recorded policy means legacy treatment; no successful turn means the
  // recovery period has not started. Neither is silently assigned a deadline.
  return sql<number | null>`(
    SELECT MAX(${sessionRunsTable.completedAt}) FROM ${sessionRunsTable}
    WHERE ${sessionRunsTable.sessionId} = ${sessionId}
      AND ${sessionRunsTable.status} = 'completed'
  ) + json_extract(${sessionExecutionSnapshotsTable.planJson}, '$.recoveryRetentionMs')`;
}

export function sessionRecoveryAvailablePredicate(db: AppDatabase, admittedAt: number) {
  return notExists(
    db
      .select({ sessionId: sessionExecutionSnapshotsTable.sessionId })
      .from(sessionExecutionSnapshotsTable)
      .where(
        and(
          eq(sessionExecutionSnapshotsTable.sessionId, sessionsTable.id),
          lte(recoveryExpiresAt(sessionsTable.id), admittedAt),
        ),
      ),
  );
}

export async function getSessionRecoveryExpiresAt(
  database: D1Database,
  sessionId: SessionId,
): Promise<number | null> {
  const record = await getAppDatabase(database)
    .select({ expiresAt: recoveryExpiresAt(sessionId) })
    .from(sessionExecutionSnapshotsTable)
    .where(eq(sessionExecutionSnapshotsTable.sessionId, sessionId))
    .get();
  return record?.expiresAt ?? null;
}
