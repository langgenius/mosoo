import { sandboxesTable, sessionsTable } from "@mosoo/db";
import type { RuntimeOperationId, SessionId } from "@mosoo/id";
import { and, eq, exists, isNull, notLike, or, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import type { AppDatabase } from "../../../platform/db/drizzle";

// A migration claim has no lease expiry. Only its reviewed recovery sequence
// may reopen admission after both the physical fence and D1 transition settle.
const ISOLATION_CLAIM_PREFIX = "session-isolation:";

export function sessionIsolationClaimOwner(operationId: RuntimeOperationId): string {
  return `${ISOLATION_CLAIM_PREFIX}${operationId}`;
}

export function sandboxIsolationAvailablePredicate() {
  return or(
    isNull(sandboxesTable.claimOwner),
    notLike(sandboxesTable.claimOwner, `${ISOLATION_CLAIM_PREFIX}%`),
  )!;
}

export function sessionIsolationPendingPredicate(db: AppDatabase) {
  return exists(
    db
      .select({ id: sandboxesTable.id })
      .from(sandboxesTable)
      .where(
        eq(
          sandboxesTable.claimOwner,
          sql`${ISOLATION_CLAIM_PREFIX} || ${sessionsTable.statusOperationId}`,
        ),
      ),
  );
}

function sessionIsolationOperationQuery(db: AppDatabase, sessionId: SessionId) {
  return db
    .select({ operationId: sessionsTable.statusOperationId })
    .from(sessionsTable)
    .where(and(eq(sessionsTable.id, sessionId), sessionIsolationPendingPredicate(db)))
    .limit(1);
}

interface CompiledQuery {
  toSQL(): { sql: string; params: unknown[] };
}

export async function runSessionIsolationAwareBatch(
  database: D1Database,
  sessionId: SessionId,
  buildQueries: (db: AppDatabase) => readonly CompiledQuery[],
): Promise<{ results: D1Result[]; isolationPending: boolean }> {
  const db = getAppDatabase(database);
  // As in Driver binding admission, use native D1 batch for a write plus read.
  // The general app compatibility adapter intentionally excludes returned rows.
  // Capture the marker in the transaction, before another request can release
  // it; do not mutate a Session merely to discover why admission was rejected.
  const queries = [...buildQueries(db), sessionIsolationOperationQuery(db, sessionId)];
  const results = await database.batch(
    queries.map((query) => {
      const compiled = query.toSQL();
      return database.prepare(compiled.sql).bind(...compiled.params);
    }),
  );
  const marker = results.pop();
  if (!marker) throw new Error("Session isolation batch did not return its admission marker.");
  return { results, isolationPending: marker.results.length > 0 };
}

export async function waitForSessionIsolation(
  database: D1Database,
  sessionId: SessionId,
): Promise<void> {
  const db = getAppDatabase(database);
  let delayMs = 50;
  while (await sessionIsolationOperationQuery(db, sessionId).get()) {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    delayMs = Math.min(delayMs * 2, 500);
  }
}
