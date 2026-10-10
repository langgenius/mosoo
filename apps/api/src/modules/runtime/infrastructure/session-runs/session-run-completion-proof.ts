import { parseNativeCheckpoint } from "@mosoo/agent-driver/runtime";
import { sandboxBackupsTable, sessionEventsTable } from "@mosoo/db";
import type { SessionId, SessionRunId } from "@mosoo/id";
import { parseRuntimeEventEnvelope, readRuntimeEventPayload } from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";
import { and, eq } from "drizzle-orm";

import { getAppDatabase } from "../../../../platform/db/drizzle";

export interface SessionRunCompletionProof {
  readonly event: RuntimeEventEnvelope;
  readonly sourceEventId: string;
}

export async function getSessionRunCompletionProof(
  database: D1Database,
  input: { sessionId: SessionId; runId: SessionRunId },
): Promise<SessionRunCompletionProof | null> {
  const receipt = await getAppDatabase(database)
    .select({
      canonicalEventJson: sessionEventsTable.canonicalEventJson,
      sourceEventId: sessionEventsTable.sourceEventId,
    })
    .from(sessionEventsTable)
    .where(
      and(
        eq(sessionEventsTable.sessionId, input.sessionId),
        eq(sessionEventsTable.runId, input.runId),
        eq(sessionEventsTable.eventType, "run.completed"),
      ),
    )
    .limit(1)
    .get();
  if (receipt === undefined || receipt.canonicalEventJson === null) return null;

  let event: RuntimeEventEnvelope;
  try {
    event = parseRuntimeEventEnvelope(JSON.parse(receipt.canonicalEventJson));
    const committed = parseNativeCheckpoint(readRuntimeEventPayload(event)["checkpoint"]);
    if (
      event.kind !== "run.completed" ||
      event.runId !== input.runId ||
      event.sessionId !== input.sessionId ||
      committed.runId !== String(input.runId) ||
      event.runtimeId !== committed.nativeRef.runtimeId
    )
      return null;
  } catch {
    // Malformed legacy receipts cannot prove that native state was committed.
    return null;
  }

  // The receipt was committed atomically with this Run's checkpoint and backup.
  // A later Run may advance the Session's native continuation pointer.
  const backup = await getAppDatabase(database)
    .select({ id: sandboxBackupsTable.id })
    .from(sandboxBackupsTable)
    .where(
      and(
        eq(sandboxBackupsTable.sessionRunId, input.runId),
        eq(sandboxBackupsTable.status, "ready"),
      ),
    )
    .limit(1)
    .get();
  return backup === undefined ? null : { event, sourceEventId: receipt.sourceEventId };
}
