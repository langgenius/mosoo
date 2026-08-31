import { describe, expect, test } from "bun:test";

import type { RuntimeOperationId, SessionId } from "@mosoo/id";
import {
  createRuntimeEventSemanticHash,
  stringifyRuntimeEventSemanticValue,
} from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";

import { createRuntimeOperationSessionEvent } from "../src/modules/runtime/application/runtime-state-operation-events";
import type { RuntimeOperationEvent } from "../src/modules/runtime/application/runtime-state-operation-events";
import { createSessionRuntimeEventProjection } from "../src/modules/sessions/domain/session-runtime-event-projection";
import { applyDrizzleMigration, applyDrizzleMigrationsBefore } from "./helpers/drizzle-migrations";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const MIGRATION_TAG = "0019_runtime-operation-ready-authority";

const ACCOUNT_ID = "01J0000000000000000000001K";
const AGENT_ID = "01J0000000000000000000001J";
const PROJECT_ID = "01J0000000000000000000001M";
const SESSION_ID = "01J0000000000000000000001H" as SessionId;
const OPERATION_ID = "01J0000000000000000000001R" as RuntimeOperationId;
const LEGACY_OPERATION_ID = "01J0000000000000000000001S" as RuntimeOperationId;

async function createPre0018Database(): Promise<SqliteD1Database> {
  const database = new SqliteD1Database();
  applyDrizzleMigrationsBefore(database, MIGRATION_TAG);
  return database;
}

async function insertSession(database: SqliteD1Database): Promise<void> {
  await database
    .prepare(
      `INSERT INTO session (
         agent_id, created_at, creator_account_id, id, kind, model, project_id,
         provider, renamed, runtime_id, status, updated_at
       ) VALUES (?, 1, ?, ?, 'agent', 'gpt-5.4', ?, 'openai', 0, 'codex', 'IDLE', 1)`,
    )
    .bind(AGENT_ID, ACCOUNT_ID, SESSION_ID, PROJECT_ID)
    .run();
}

async function insertLegacyReadyReceipt(database: SqliteD1Database): Promise<void> {
  await database
    .prepare(
      `INSERT INTO session_event (
         agent_id, content_text, created_at, ended_at, event_type, family, id,
         occurred_at, process_status, process_type, semantic_hash, seq, session_id,
         source_event_id, source, visibility
       ) VALUES (?, '', 1, 1, 'agent.task.updated', 'agent', ?, 1, 'available',
                 'agent_task', ?, 1, ?, ?, 'api', 'all_consumers')`,
    )
    .bind(
      AGENT_ID,
      "01J0000000000000000000001T",
      "0".repeat(64),
      SESSION_ID,
      `runtime-operation:${LEGACY_OPERATION_ID}:${SESSION_ID}:ready`,
    )
    .run();
}

function operationEvent(status: RuntimeOperationEvent["status"]): RuntimeOperationEvent {
  return {
    agentId: AGENT_ID,
    observedAt: status === "updating" ? "2026-08-30T00:00:00.000Z" : "2026-08-30T00:00:01.000Z",
    operation: "restartDriver",
    status,
  };
}

async function insertCanonicalOperationEvent(
  database: SqliteD1Database,
  status: RuntimeOperationEvent["status"],
  seq: number,
): Promise<RuntimeEventEnvelope> {
  const event = createRuntimeOperationSessionEvent({
    event: operationEvent(status),
    operationId: OPERATION_ID,
    sessionId: SESSION_ID,
  });
  const projection = createSessionRuntimeEventProjection(event);
  const occurredAt = Date.parse(event.occurredAt);
  await database
    .prepare(
      `INSERT INTO session_event (
         agent_id, content_text, created_at, ended_at, event_type, family, id,
         occurred_at, process_status, process_type, run_id,
         runtime_operation_event_json, semantic_hash, seq, session_id,
         source_event_id, source, stream_id, trace_id, visibility
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      AGENT_ID,
      projection.contentText,
      occurredAt,
      occurredAt,
      projection.eventType,
      projection.family,
      event.id,
      occurredAt,
      projection.processStatus,
      projection.processType,
      projection.runId,
      stringifyRuntimeEventSemanticValue(event),
      await createRuntimeEventSemanticHash(event),
      seq,
      SESSION_ID,
      event.sourceEventId,
      projection.source,
      projection.streamId,
      projection.traceId,
      projection.visibility,
    )
    .run();
  return event;
}

describe("runtime operation authority migration", () => {
  test("preserves legacy NULL while admitting both canonical operation phases", async () => {
    const database = await createPre0018Database();
    await insertSession(database);
    await insertLegacyReadyReceipt(database);

    applyDrizzleMigration(database, MIGRATION_TAG);

    expect(
      (
        await database.prepare("PRAGMA table_info(session_event)").all<{ name: string }>()
      ).results.map(({ name }) => name),
    ).toContain("runtime_operation_event_json");
    await expect(
      database
        .prepare(
          `SELECT runtime_operation_event_json
             FROM session_event
            WHERE source_event_id LIKE 'runtime-operation:%:ready'`,
        )
        .first(),
    ).resolves.toEqual({ runtime_operation_event_json: null });

    await insertCanonicalOperationEvent(database, "updating", 2);
    await insertCanonicalOperationEvent(database, "ready", 3);
    const rows = await database
      .prepare(
        `SELECT json_extract(runtime_operation_event_json, '$.payload.status') AS status
           FROM session_event
          WHERE runtime_operation_event_json IS NOT NULL
          ORDER BY seq`,
      )
      .all<{ status: string }>();
    expect(rows.results).toEqual([{ status: "updating" }, { status: "ready" }]);
  });

  test("rejects a non-operation phase authority carrier", async () => {
    const database = await createPre0018Database();
    await insertSession(database);
    applyDrizzleMigration(database, MIGRATION_TAG);
    const event = await insertCanonicalOperationEvent(database, "updating", 1);
    const forged = {
      ...event,
      id: "01J0000000000000000000001V",
      payload: { ...(event.payload as Record<string, unknown>), status: "forged" },
      sourceEventId: "forged-runtime-operation-event",
    } satisfies RuntimeEventEnvelope;

    await expect(
      database
        .prepare(
          `INSERT INTO session_event (
             agent_id, content_text, created_at, ended_at, event_type, family, id,
             occurred_at, process_status, process_type, runtime_operation_event_json,
             semantic_hash, seq, session_id, source_event_id, source, visibility
           ) VALUES (?, '', 2, 2, 'agent.task.updated', 'agent', ?, 2, 'available',
                     'agent_task', ?, ?, 2, ?, ?, 'api', 'all_consumers')`,
        )
        .bind(
          AGENT_ID,
          forged.id,
          stringifyRuntimeEventSemanticValue(forged),
          await createRuntimeEventSemanticHash(forged),
          SESSION_ID,
          forged.sourceEventId,
        )
        .run(),
    ).rejects.toThrow("CHECK constraint failed");
  });
});
