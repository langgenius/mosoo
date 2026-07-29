import {
  driverInstancesTable,
  sandboxesTable,
  sandboxSessionsTable,
  sessionEventsTable,
  sessionRunsTable,
} from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type {
  DriverInstanceId,
  SandboxId,
  SandboxSessionId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";
import { parseRuntimeTimingProcessContent } from "@mosoo/runtime-events";
import type { RuntimeTimingPayload } from "@mosoo/runtime-events";
import { and, asc, eq, isNull, or } from "drizzle-orm";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import {
  closeSessionViewerSockets,
  readSessionRuntimePerformanceIdentityEvidence,
} from "../../../sessions/infrastructure/session/client";
import { RUNTIME_PERFORMANCE_IDENTITY_EVIDENCE_SCHEMA } from "../../../sessions/infrastructure/session/runtime-performance-identity-evidence";
import { getDriverInstanceSnapshot } from "../driver-instance/client";
import { destroyRuntimeSubjectContainer } from "../runtime-subject-lifecycle/runtime-subject-platform";

export interface RuntimePerformanceIdentity {
  readonly containerApplicationId: string;
  readonly containerDeploymentId: string;
  readonly containerDurableObjectId: string;
  readonly containerObservedAt: string;
  readonly containerPlacementId: string;
  readonly driverBundleSha256: string;
  readonly driverCreatedAt: string;
  readonly driverInstanceId: string;
  readonly runId: string;
  readonly sandboxId: string;
  readonly sandboxSessionId: string;
  readonly threadId: string;
}

export interface RuntimePerformanceCleanupState {
  readonly driverDeleted: boolean;
  readonly sandboxCold: boolean;
  readonly sandboxSessionDeleted: boolean;
  readonly sessionDeleted: boolean;
}

export interface RuntimePerformanceTimingTraceEntry {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly seq: number;
  readonly timing: RuntimeTimingPayload;
}

export interface RuntimePerformanceTimingTrace {
  readonly firstVisibleDelta: {
    readonly d1RowCreatedAt: string;
    readonly eventId: string;
    readonly occurredAt: string;
    readonly seq: number;
    readonly sourceEventId: string;
  } | null;
  readonly runAcceptedAt: string;
  readonly timings: readonly RuntimePerformanceTimingTraceEntry[];
}

interface RuntimePerformanceTimingRow {
  readonly contentText: string;
  readonly eventId: string;
  readonly occurredAt: number;
  readonly seq: number;
}

export function parseRuntimePerformanceTimingRows(
  rows: readonly RuntimePerformanceTimingRow[],
  input: {
    readonly includePrewarm?: boolean;
    readonly runId: SessionRunId;
    readonly threadId: SessionId;
  },
): RuntimePerformanceTimingTraceEntry[] {
  return rows.map((row) => {
    const timing = parseRuntimeTimingProcessContent(row.contentText);
    const expectedRunlessTiming =
      input.includePrewarm === true &&
      timing.runId === null &&
      ((timing.source === "api" && timing.stage === "prewarm" && timing.path === "prewarm") ||
        (timing.source === "driver" &&
          timing.stage === "driver_backend" &&
          (timing.path === "cold" || timing.path === "prewarm")));

    if (
      timing.sessionId !== input.threadId ||
      (timing.runId !== input.runId && !expectedRunlessTiming)
    ) {
      throw new Error(
        `Runtime performance timing identity did not match the requested run (source=${timing.source}, stage=${timing.stage}, path=${timing.path}, run=${timing.runId === null ? "null" : timing.runId === input.runId ? "expected" : "other"}, session=${timing.sessionId === input.threadId ? "expected" : "other"}).`,
      );
    }

    return {
      eventId: row.eventId,
      occurredAt: new Date(row.occurredAt).toISOString(),
      seq: row.seq,
      timing,
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireIdentityString(
  record: Record<string, unknown>,
  field: string,
  label: string,
): string {
  const value = record[field];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Runtime performance identity did not expose ${label}.`);
  }

  return value.trim();
}

export function parseDriverRuntimeIdentitySnapshot(value: unknown) {
  if (!isRecord(value)) {
    throw new Error("Runtime performance identity did not expose the Driver hello attestation.");
  }

  const driverBundleSha256 = requireIdentityString(
    value,
    "driverBundleSha256",
    "driver bundle digest",
  ).toLowerCase();

  if (!/^[0-9a-f]{64}$/u.test(driverBundleSha256)) {
    throw new Error("Runtime performance identity emitted an invalid driver bundle digest.");
  }

  const containerObservedAt = requireIdentityString(value, "observedAt", "observation time");
  if (!Number.isFinite(Date.parse(containerObservedAt))) {
    throw new Error("Runtime performance identity emitted an invalid observation time.");
  }

  return {
    containerApplicationId: requireIdentityString(
      value,
      "containerApplicationId",
      "container application ID",
    ),
    containerDeploymentId: requireIdentityString(
      value,
      "containerDeploymentId",
      "container deployment ID",
    ),
    containerDurableObjectId: requireIdentityString(
      value,
      "containerDurableObjectId",
      "container Durable Object ID",
    ).toLowerCase(),
    containerObservedAt,
    containerPlacementId: requireIdentityString(
      value,
      "containerPlacementId",
      "container placement ID",
    ),
    driverBundleSha256,
  };
}

export function parseRuntimePerformanceIdentityEvidence(
  value: unknown,
  expected: { readonly runId: string; readonly threadId: string },
): RuntimePerformanceIdentity {
  if (!isRecord(value) || !isRecord(value["runtimeIdentity"])) {
    throw new Error("Runtime performance identity evidence is incomplete.");
  }

  if (value["schema"] !== RUNTIME_PERFORMANCE_IDENTITY_EVIDENCE_SCHEMA) {
    throw new Error("Runtime performance identity evidence has an unsupported schema.");
  }

  const driverCreatedAt = requireIdentityString(value, "driverCreatedAt", "Driver creation time");
  if (!Number.isFinite(Date.parse(driverCreatedAt))) {
    throw new Error(
      "Runtime performance identity evidence emitted an invalid Driver creation time.",
    );
  }

  const driverInstanceId = parsePlatformId<DriverInstanceId>(
    value["driverInstanceId"],
    "Runtime performance Driver instance ID",
  );
  const runId = parsePlatformId<SessionRunId>(value["runId"], "Runtime performance run ID");
  const sandboxId = parsePlatformId<SandboxId>(
    value["sandboxId"],
    "Runtime performance Sandbox ID",
  );
  const sandboxSessionId = parsePlatformId<SandboxSessionId>(
    value["sandboxSessionId"],
    "Runtime performance Sandbox Session ID",
  );
  const sandboxSubjectId = parsePlatformId<SessionId>(
    value["sandboxSubjectId"],
    "Runtime performance Sandbox subject ID",
  );
  const threadId = parsePlatformId<SessionId>(value["sessionId"], "Runtime performance Thread ID");
  if (runId !== expected.runId || threadId !== expected.threadId) {
    throw new Error("Runtime performance identity evidence did not match the requested run.");
  }

  if (
    value["sandboxKind"] !== "cattle" ||
    value["sandboxSubjectKind"] !== "session" ||
    sandboxSubjectId !== threadId
  ) {
    throw new Error("Runtime performance identity evidence resolved a non-cattle execution plane.");
  }

  const container = parseDriverRuntimeIdentitySnapshot(value["runtimeIdentity"]);
  return {
    ...container,
    driverCreatedAt,
    driverInstanceId,
    runId,
    sandboxId,
    sandboxSessionId,
    threadId,
  };
}

export async function captureRuntimePerformanceIdentity(
  bindings: ApiBindings,
  input: { readonly runId: string; readonly threadId: string },
): Promise<RuntimePerformanceIdentity> {
  const runId = parsePlatformId<SessionRunId>(input.runId, "Performance run ID");
  const threadId = parsePlatformId<SessionId>(input.threadId, "Performance thread ID");
  const evidence = await readSessionRuntimePerformanceIdentityEvidence(bindings, {
    runId,
    sessionId: threadId,
  });

  if (evidence !== null) {
    return parseRuntimePerformanceIdentityEvidence(evidence, { runId, threadId });
  }

  const row =
    (await getAppDatabase(bindings.DB)
      .select({
        driverCreatedAt: driverInstancesTable.createdAt,
        driverInstanceId: driverInstancesTable.id,
        runId: sessionRunsTable.id,
        sandboxId: driverInstancesTable.sandboxId,
        sandboxKind: sandboxesTable.kind,
        sandboxSessionId: sandboxSessionsTable.sandboxSessionId,
        sandboxSubjectId: sandboxesTable.subjectId,
        sandboxSubjectKind: sandboxesTable.subjectKind,
        threadId: sessionRunsTable.sessionId,
      })
      .from(sessionRunsTable)
      .innerJoin(
        driverInstancesTable,
        eq(driverInstancesTable.id, sessionRunsTable.driverInstanceId),
      )
      .innerJoin(
        sandboxSessionsTable,
        and(
          eq(sandboxSessionsTable.sessionId, sessionRunsTable.sessionId),
          eq(sandboxSessionsTable.sandboxId, driverInstancesTable.sandboxId),
        ),
      )
      .innerJoin(sandboxesTable, eq(sandboxesTable.id, driverInstancesTable.sandboxId))
      .where(and(eq(sessionRunsTable.id, runId), eq(sessionRunsTable.sessionId, threadId)))
      .limit(1)
      .get()) ?? null;

  if (row === null) {
    throw new Error("Runtime performance identity could not resolve the run's execution plane.");
  }

  if (
    row.sandboxKind !== "cattle" ||
    row.sandboxSubjectKind !== "session" ||
    row.sandboxSubjectId !== threadId
  ) {
    throw new Error("Runtime performance identity resolved a non-cattle execution plane.");
  }

  const snapshot = await getDriverInstanceSnapshot(bindings, row.driverInstanceId);
  const container = parseDriverRuntimeIdentitySnapshot(snapshot.hello?.runtimeIdentity);

  return {
    ...container,
    driverCreatedAt: new Date(row.driverCreatedAt).toISOString(),
    driverInstanceId: row.driverInstanceId,
    runId: row.runId,
    sandboxId: row.sandboxId,
    sandboxSessionId: row.sandboxSessionId,
    threadId: row.threadId,
  };
}

export async function captureRuntimePerformanceTrace(
  database: D1Database,
  input: { readonly runId: string; readonly threadId: string },
): Promise<RuntimePerformanceTimingTrace> {
  const runId = parsePlatformId<SessionRunId>(input.runId, "Performance run ID");
  const threadId = parsePlatformId<SessionId>(input.threadId, "Performance thread ID");
  const appDb = getAppDatabase(database);
  const [run, rows, deltaRows] = await Promise.all([
    appDb
      .select({ createdAt: sessionRunsTable.createdAt })
      .from(sessionRunsTable)
      .where(and(eq(sessionRunsTable.id, runId), eq(sessionRunsTable.sessionId, threadId)))
      .limit(1)
      .get(),
    appDb
      .select({
        contentText: sessionEventsTable.contentText,
        eventId: sessionEventsTable.id,
        occurredAt: sessionEventsTable.occurredAt,
        seq: sessionEventsTable.seq,
      })
      .from(sessionEventsTable)
      .where(
        and(
          eq(sessionEventsTable.sessionId, threadId),
          or(eq(sessionEventsTable.runId, runId), isNull(sessionEventsTable.runId)),
          eq(sessionEventsTable.eventType, "runtime.timing.recorded"),
        ),
      )
      .orderBy(asc(sessionEventsTable.seq))
      .all(),
    appDb
      .select({
        contentText: sessionEventsTable.contentText,
        createdAt: sessionEventsTable.createdAt,
        eventId: sessionEventsTable.id,
        occurredAt: sessionEventsTable.occurredAt,
        seq: sessionEventsTable.seq,
        sourceEventId: sessionEventsTable.sourceEventId,
      })
      .from(sessionEventsTable)
      .where(
        and(
          eq(sessionEventsTable.sessionId, threadId),
          eq(sessionEventsTable.runId, runId),
          eq(sessionEventsTable.eventType, "message.delta"),
          eq(sessionEventsTable.processType, "agent.message.delta"),
        ),
      )
      .orderBy(asc(sessionEventsTable.seq))
      .all(),
  ]);
  if (run === undefined) {
    throw new Error("Runtime performance trace could not resolve the requested run.");
  }

  const firstVisibleDelta = deltaRows.find(
    (row) => row.contentText !== "Message updated." && row.contentText.trim().length > 0,
  );

  return {
    firstVisibleDelta:
      firstVisibleDelta === undefined
        ? null
        : {
            d1RowCreatedAt: new Date(firstVisibleDelta.createdAt).toISOString(),
            eventId: firstVisibleDelta.eventId,
            occurredAt: new Date(firstVisibleDelta.occurredAt).toISOString(),
            seq: firstVisibleDelta.seq,
            sourceEventId: firstVisibleDelta.sourceEventId,
          },
    runAcceptedAt: new Date(run.createdAt).toISOString(),
    timings: parseRuntimePerformanceTimingRows(rows, {
      includePrewarm: true,
      runId,
      threadId,
    }),
  };
}

export async function disconnectRuntimePerformanceViewers(
  bindings: ApiBindings,
  input: { readonly threadId: string },
): Promise<{ readonly disconnected: true }> {
  const threadId = parsePlatformId<SessionId>(input.threadId, "Performance thread ID");

  await closeSessionViewerSockets(bindings, threadId, "performance.reconnect.probe");

  return { disconnected: true };
}

export async function inspectRuntimePerformanceCleanup(
  database: D1Database,
  input: {
    readonly driverInstanceId: string;
    readonly sandboxId: string;
    readonly threadId: string;
  },
): Promise<RuntimePerformanceCleanupState> {
  const row = await database
    .prepare(
      `SELECT
         NOT EXISTS(SELECT 1 FROM driver_instance WHERE id = ?1) AS driver_deleted,
         EXISTS(SELECT 1 FROM sandbox WHERE id = ?2 AND status = 'cold') AS sandbox_cold,
         NOT EXISTS(SELECT 1 FROM sandbox_session WHERE sandbox_id = ?2) AS sandbox_session_deleted,
         NOT EXISTS(SELECT 1 FROM session WHERE id = ?3) AS session_deleted`,
    )
    .bind(input.driverInstanceId, input.sandboxId, input.threadId)
    .first<{
      driver_deleted: number;
      sandbox_cold: number;
      sandbox_session_deleted: number;
      session_deleted: number;
    }>();

  if (row === null) {
    throw new Error("Runtime performance cleanup state query returned no row.");
  }

  return {
    driverDeleted: row.driver_deleted === 1,
    sandboxCold: row.sandbox_cold === 1,
    sandboxSessionDeleted: row.sandbox_session_deleted === 1,
    sessionDeleted: row.session_deleted === 1,
  };
}

export async function destroyRuntimePerformanceContainer(
  bindings: ApiBindings,
  input: { readonly sandboxId: string },
): Promise<{ readonly destroyed: true }> {
  const sandboxId = parsePlatformId<SandboxId>(input.sandboxId, "Performance sandbox ID");

  await destroyRuntimeSubjectContainer(bindings, sandboxId);

  return { destroyed: true };
}
