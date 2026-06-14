import type {
  SessionPermissionRequestView,
  SessionReadinessSnapshotView,
} from "@mosoo/ag-ui-session";
import {
  SessionPermissionRequestViewSchema,
  SessionReadinessSnapshotViewSchema,
} from "@mosoo/ag-ui-session";
import { parseSchemaValue } from "@mosoo/contracts/validation";
import { sessionPermissionRequestsTable, sessionReadinessSnapshotsTable } from "@mosoo/db";
import type { DriverInstanceId, SessionId, SessionRunId } from "@mosoo/id";
import {
  readRuntimeEventPayload,
  readRuntimeEventPermissionRequest,
  readRuntimeEventString,
} from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";
import { and, eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";

export interface SessionViewerProjectionRuntimeEvent {
  readonly event: RuntimeEventEnvelope;
  readonly occurredAt: number | null;
  readonly sessionId: SessionId;
}

function toProjectionTimestamp(record: SessionViewerProjectionRuntimeEvent): number {
  if (record.occurredAt !== null) {
    return record.occurredAt;
  }

  const occurredAt = Date.parse(record.event.occurredAt);
  return Number.isFinite(occurredAt) ? occurredAt : currentTimestampMs();
}

function parsePermissionRequestViews(value: unknown): SessionPermissionRequestView[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const requests: SessionPermissionRequestView[] = [];

  for (const entry of value) {
    requests.push(parseSchemaValue(SessionPermissionRequestViewSchema, entry));
  }

  return requests;
}

async function upsertPermissionRequest(
  database: D1Database,
  record: SessionViewerProjectionRuntimeEvent,
): Promise<void> {
  const request = readRuntimeEventPermissionRequest(record.event);

  if (request === null) {
    return;
  }

  const timestamp = toProjectionTimestamp(record);

  await getAppDatabase(database)
    .insert(sessionPermissionRequestsTable)
    .values({
      createdAt: timestamp,
      driverInstanceId: request.driverInstanceId,
      rawInput: request.rawInput,
      requestId: request.requestId,
      runId: request.runId,
      sessionId: record.sessionId,
      title: request.title,
      toolCallId: request.toolCallId,
      toolKind: request.toolKind,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      set: {
        driverInstanceId: request.driverInstanceId,
        rawInput: request.rawInput,
        runId: request.runId,
        title: request.title,
        toolCallId: request.toolCallId,
        toolKind: request.toolKind,
        updatedAt: timestamp,
      },
      target: [sessionPermissionRequestsTable.sessionId, sessionPermissionRequestsTable.requestId],
    })
    .run();
}

async function replacePermissionRequests(
  database: D1Database,
  record: SessionViewerProjectionRuntimeEvent,
  permissionRequests: readonly SessionPermissionRequestView[],
): Promise<void> {
  const timestamp = toProjectionTimestamp(record);
  const db = getAppDatabase(database);

  await db
    .delete(sessionPermissionRequestsTable)
    .where(eq(sessionPermissionRequestsTable.sessionId, record.sessionId))
    .run();

  if (permissionRequests.length === 0) {
    return;
  }

  await db
    .insert(sessionPermissionRequestsTable)
    .values(
      permissionRequests.map((request) => ({
        createdAt: timestamp,
        driverInstanceId: request.driverInstanceId as DriverInstanceId,
        rawInput: request.rawInput,
        requestId: request.requestId,
        runId: request.runId as SessionRunId,
        sessionId: record.sessionId,
        title: request.title,
        toolCallId: request.toolCallId,
        toolKind: request.toolKind,
        updatedAt: timestamp,
      })),
    )
    .run();
}

async function removePermissionRequestById(
  database: D1Database,
  input: {
    readonly requestId: string;
    readonly sessionId: SessionId;
  },
): Promise<void> {
  await getAppDatabase(database)
    .delete(sessionPermissionRequestsTable)
    .where(
      and(
        eq(sessionPermissionRequestsTable.sessionId, input.sessionId),
        eq(sessionPermissionRequestsTable.requestId, input.requestId),
      ),
    )
    .run();
}

async function clearRunPermissionRequests(
  database: D1Database,
  record: SessionViewerProjectionRuntimeEvent,
): Promise<void> {
  const runId = record.event.runId;

  if (runId === undefined) {
    return;
  }

  await getAppDatabase(database)
    .delete(sessionPermissionRequestsTable)
    .where(
      and(
        eq(sessionPermissionRequestsTable.sessionId, record.sessionId),
        eq(sessionPermissionRequestsTable.runId, runId),
      ),
    )
    .run();
}

async function appPermissionResolution(
  database: D1Database,
  record: SessionViewerProjectionRuntimeEvent,
): Promise<void> {
  const payload = readRuntimeEventPayload(record.event);
  const permissionRequests = parsePermissionRequestViews(payload["permissionRequests"]);

  if (permissionRequests !== null) {
    await replacePermissionRequests(database, record, permissionRequests);
    return;
  }

  const requestId = readRuntimeEventString(payload, "requestId");

  if (requestId !== null) {
    await removePermissionRequestById(database, {
      requestId,
      sessionId: record.sessionId,
    });
  }
}

async function upsertReadinessSnapshot(
  database: D1Database,
  record: SessionViewerProjectionRuntimeEvent,
): Promise<void> {
  const readiness = parseSchemaValue(
    SessionReadinessSnapshotViewSchema,
    record.event.payload,
  ) satisfies SessionReadinessSnapshotView;
  const timestamp = toProjectionTimestamp(record);
  const readinessJson = JSON.stringify(readiness);

  await getAppDatabase(database)
    .insert(sessionReadinessSnapshotsTable)
    .values({
      readinessJson,
      sessionId: record.sessionId,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      set: {
        readinessJson,
        updatedAt: timestamp,
      },
      target: sessionReadinessSnapshotsTable.sessionId,
    })
    .run();
}

export async function appSessionViewerRuntimeEvents(
  database: D1Database,
  records: readonly SessionViewerProjectionRuntimeEvent[],
): Promise<void> {
  for (const record of records) {
    switch (record.event.kind) {
      case "permission.requested": {
        await upsertPermissionRequest(database, record);
        break;
      }
      case "permission.resolved": {
        await appPermissionResolution(database, record);
        break;
      }
      case "run.cancelled":
      case "run.completed":
      case "run.failed": {
        await clearRunPermissionRequests(database, record);
        break;
      }
      case "session.readiness.updated": {
        await upsertReadinessSnapshot(database, record);
        break;
      }
      default: {
        break;
      }
    }
  }
}
