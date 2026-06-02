import { parseSchemaValue } from "@mosoo/contracts/validation";
import { nativeResumeRefsTable } from "@mosoo/db";
import { DriverNativeRuntimeRef } from "@mosoo/driver-protocol";
import type {
  DriverNativeRuntimeRef as DriverNativeRuntimeRefValue,
  DriverNativeRuntimeRefKind,
  DriverRuntime,
} from "@mosoo/driver-protocol";
import type { DriverInstanceId, SessionId, SessionRunId } from "@mosoo/id";
import { eq, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";

interface NativeResumeRefRow {
  kind: string;
  runtime_id: string;
  value: string;
}

export interface NativeResumeRefObservation {
  driverInstanceId: DriverInstanceId;
  nativeResumeRef: DriverNativeRuntimeRefValue;
  sessionId: SessionId;
  sessionRunId: SessionRunId;
}

function expectedNativeRuntimeRefKind(
  runtimeId: DriverNativeRuntimeRefValue["runtimeId"],
): DriverNativeRuntimeRefKind {
  switch (runtimeId) {
    case "openai-runtime": {
      return "openai_thread_id";
    }
    case "claude-agent-sdk": {
      return "claude_session_id";
    }
    case "acp-fallback": {
      return "acp_session_id";
    }
    default: {
      throw new Error("Unsupported native runtime ref runtime.");
    }
  }
}

function enforceNativeRuntimeRefShape(ref: DriverNativeRuntimeRefValue): void {
  const expectedKind = expectedNativeRuntimeRefKind(ref.runtimeId);

  if (ref.kind !== expectedKind) {
    throw new Error(`Native resume ref kind ${ref.kind} does not match runtime ${ref.runtimeId}.`);
  }
}

function toNativeRuntimeRef(row: NativeResumeRefRow): DriverNativeRuntimeRefValue {
  const ref = parseSchemaValue(DriverNativeRuntimeRef, {
    kind: row.kind,
    runtimeId: row.runtime_id,
    value: row.value,
  });

  enforceNativeRuntimeRefShape(ref);
  return ref;
}

export async function getNativeResumeRefForRuntime(
  database: D1Database,
  input: {
    runtimeId: DriverRuntime;
    sessionId: SessionId;
  },
): Promise<DriverNativeRuntimeRefValue | null> {
  const row =
    (await getAppDatabase(database)
      .select({
        kind: nativeResumeRefsTable.kind,
        runtime_id: nativeResumeRefsTable.runtimeId,
        value: nativeResumeRefsTable.value,
      })
      .from(nativeResumeRefsTable)
      .where(eq(nativeResumeRefsTable.sessionId, input.sessionId))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return null;
  }

  const ref = toNativeRuntimeRef(row);

  return ref.runtimeId === input.runtimeId ? ref : null;
}

export async function upsertNativeResumeRef(
  database: D1Database,
  observation: NativeResumeRefObservation,
): Promise<void> {
  enforceNativeRuntimeRefShape(observation.nativeResumeRef);

  const timestampMs = currentTimestampMs();

  await getAppDatabase(database)
    .insert(nativeResumeRefsTable)
    .values({
      createdAt: timestampMs,
      kind: observation.nativeResumeRef.kind,
      observedDriverInstanceId: observation.driverInstanceId,
      observedSessionRunId: observation.sessionRunId,
      runtimeId: observation.nativeResumeRef.runtimeId,
      sessionId: observation.sessionId,
      updatedAt: timestampMs,
      value: observation.nativeResumeRef.value,
    })
    .onConflictDoUpdate({
      set: {
        kind: sql`excluded.kind`,
        observedDriverInstanceId: sql`excluded.observed_driver_instance_id`,
        observedSessionRunId: sql`excluded.observed_session_run_id`,
        runtimeId: sql`excluded.runtime_id`,
        updatedAt: sql`excluded.updated_at`,
        value: sql`excluded.value`,
      },
      target: nativeResumeRefsTable.sessionId,
    })
    .run();
}
