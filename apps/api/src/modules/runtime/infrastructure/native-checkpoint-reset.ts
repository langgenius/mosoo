import { nativeRuntimeRefsEqual } from "@mosoo/agent-driver/runtime";
import type { DriverNativeRuntimeRef, NativeCheckpoint } from "@mosoo/agent-driver/runtime";
import { nativeResumeRefsTable, sandboxSessionsTable, sessionsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { DriverInstanceId, SessionRunId } from "@mosoo/id";
import { and, eq, exists, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import {
  canonicalRuntimeEventJson,
  getSessionRuntimeEventSourceReceipts,
  prepareSessionRuntimeEventInsert,
} from "../../sessions/infrastructure/session-runtime-event-store.repository";
import type {
  ProjectedRuntimeEventRecord,
  RuntimeSessionLink,
} from "./driver-instance/event-types";
import { terminalConflict } from "./driver-instance/terminal-conflict";

export async function resetNativeResumeCheckpoint(
  bindings: ApiBindings,
  input: {
    driverInstanceId: DriverInstanceId;
    link: RuntimeSessionLink;
    newNativeRef: DriverNativeRuntimeRef;
    previousCheckpoint: NativeCheckpoint | null;
    previousNativeRef: DriverNativeRuntimeRef;
    record: ProjectedRuntimeEventRecord;
  },
): Promise<void> {
  const sessionId = input.link.sessionId;
  if (
    sessionId === null ||
    input.link.sandboxId === null ||
    input.record.event.kind !== "runtime.session.reset"
  ) {
    throw new Error("Native reset requires a canonical session reset event.");
  }
  if (
    input.previousNativeRef.runtimeId !== input.newNativeRef.runtimeId ||
    (input.previousCheckpoint !== null &&
      !nativeRuntimeRefsEqual(input.previousCheckpoint.nativeRef, input.previousNativeRef))
  ) {
    throw new Error("Native reset previous checkpoint and runtime do not match.");
  }
  // Read the durable receipt before checking current state. Replaying a reset
  // must not invalidate a newer successful Run.
  const event = await prepareSessionRuntimeEventInsert(bindings.DB, {
    record: input.record,
    sessionId,
  });
  if (event === null) return;

  const db = getAppDatabase(bindings.DB);
  const timestampMs = currentTimestampMs();
  const expectedCheckpoint =
    input.previousCheckpoint === null
      ? or(
          isNotNull(nativeResumeRefsTable.invalidatedAt),
          and(
            isNull(nativeResumeRefsTable.committedSessionRunId),
            isNull(nativeResumeRefsTable.committedValue),
          ),
        )
      : and(
          isNull(nativeResumeRefsTable.invalidatedAt),
          eq(nativeResumeRefsTable.committedFormatVersion, input.previousCheckpoint.formatVersion),
          eq(
            nativeResumeRefsTable.committedSessionRunId,
            parsePlatformId<SessionRunId>(input.previousCheckpoint.runId, "reset previous Run"),
          ),
          eq(nativeResumeRefsTable.committedValue, input.previousCheckpoint.nativeRef.value),
        );
  const update = {
    invalidatedAt: timestampMs,
    invalidatedSourceEventId: input.record.sourceEventId,
    observedDriverInstanceId: input.driverInstanceId,
    observedSessionRunId: null,
    updatedAt: timestampMs,
    value: input.newNativeRef.value,
  };
  const writable = and(
    exists(
      db
        .select({ id: sessionsTable.id })
        .from(sessionsTable)
        .where(
          and(
            eq(sessionsTable.id, sessionId),
            isNull(sessionsTable.archivedAt),
            inArray(sessionsTable.status, ["IDLE", "RUNNING"]),
          ),
        ),
    ),
    exists(
      db
        .select({ id: sandboxSessionsTable.sessionId })
        .from(sandboxSessionsTable)
        .where(
          and(
            eq(sandboxSessionsTable.sessionId, sessionId),
            eq(sandboxSessionsTable.sandboxId, input.link.sandboxId),
            eq(sandboxSessionsTable.status, "active"),
          ),
        ),
    ),
  );
  const expected = and(
    eq(nativeResumeRefsTable.kind, input.previousNativeRef.kind),
    eq(nativeResumeRefsTable.runtimeId, input.previousNativeRef.runtimeId),
    eq(nativeResumeRefsTable.value, input.previousNativeRef.value),
    expectedCheckpoint,
    writable,
  );
  const mutation =
    input.previousCheckpoint === null
      ? db
          .insert(nativeResumeRefsTable)
          .select(
            db
              .select({
                committedFormatVersion: sql<null>`null`.as("committed_format_version"),
                committedSessionRunId: sql<null>`null`.as("committed_session_run_id"),
                committedValue: sql<null>`null`.as("committed_value"),
                createdAt: sql<number>`${timestampMs}`.as("created_at"),
                kind: sql<typeof input.newNativeRef.kind>`${input.newNativeRef.kind}`.as("kind"),
                invalidatedAt: sql<number>`${timestampMs}`.as("invalidated_at"),
                invalidatedSourceEventId: sql<string>`${input.record.sourceEventId}`.as(
                  "invalidated_source_event_id",
                ),
                observedDriverInstanceId: sql<DriverInstanceId>`${input.driverInstanceId}`.as(
                  "observed_driver_instance_id",
                ),
                observedSessionRunId: sql<null>`null`.as("observed_session_run_id"),
                runtimeId: sql<
                  typeof input.newNativeRef.runtimeId
                >`${input.newNativeRef.runtimeId}`.as("runtime_id"),
                sessionId: sql<typeof sessionId>`${sessionId}`.as("session_id"),
                updatedAt: sql<number>`${timestampMs}`.as("updated_at"),
                value: sql<string>`${input.newNativeRef.value}`.as("value"),
              })
              .from(sessionsTable)
              .where(and(eq(sessionsTable.id, sessionId), writable)),
          )
          .onConflictDoUpdate({
            target: nativeResumeRefsTable.sessionId,
            set: update,
            setWhere: expected!,
          })
      : db
          .update(nativeResumeRefsTable)
          .set(update)
          .where(and(eq(nativeResumeRefsTable.sessionId, sessionId), expected));
  await db.batch([mutation, ...event.writes(db, sql`changes() = 1`)]);
  const receipt = (
    await getSessionRuntimeEventSourceReceipts(bindings.DB, {
      sessionId,
      sourceEventIds: [input.record.sourceEventId],
    })
  ).get(input.record.sourceEventId);
  if (
    receipt === undefined ||
    receipt.canonicalEventJson !== canonicalRuntimeEventJson(input.record.event)
  ) {
    throw terminalConflict({
      currentStatus: input.link.sessionRunStatus,
      runId: input.link.sessionRunId,
      sourceEventId: input.record.sourceEventId,
      reason: "Native reset conflicts with the current checkpoint or lifecycle operation.",
    });
  }
}
