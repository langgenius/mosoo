import type { AgentId, RuntimeEventId, SessionId, SessionRunId } from "@mosoo/id";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";

import type { createSessionRuntimeEventProjection } from "../domain/session-runtime-event-projection";

type SessionRuntimeEventProjection = ReturnType<typeof createSessionRuntimeEventProjection>;

export interface PersistSessionRuntimeEventsInput {
  records: readonly SessionRuntimeEventInput[];
  readonly sessionId: SessionId;
}

export interface PersistSessionRuntimeEventsResult {
  readonly persistedCount: number;
  readonly persistedEvents: readonly SessionRuntimeEventRecord[];
  readonly persistedSourceEventIds: readonly string[];
}

export interface SessionRuntimeEventInput {
  readonly event: SessionRuntimeEventRecord;
  readonly occurredAt: number | null;
  readonly sourceEventId: string | null;
}

export type SessionRuntimeEventRecord = RuntimeEventEnvelope;

export interface SerializedSessionRuntimeEventInput {
  readonly event: SessionRuntimeEventRecord;
  readonly occurredAt: number | null;
  readonly sourceEventId: string;
}

export interface ProjectedSessionRuntimeEventInput extends SerializedSessionRuntimeEventInput {
  readonly projection: SessionRuntimeEventProjection;
}

export interface ProjectedSessionRuntimeEventRowInput {
  readonly row: ProjectedSessionRuntimeEventInput;
  readonly sourceIndex: number;
}

export interface SessionRuntimeEventBatchAllocation {
  readonly agentId: AgentId;
  readonly firstSeq: number;
}

export interface OneRuntimeEventPerSessionAllocation {
  readonly agentId: AgentId;
  readonly seq: number;
  readonly sessionId: SessionId;
}

export interface OneRuntimeEventPerSessionInput {
  readonly event: SessionRuntimeEventRecord;
  readonly occurredAt: number | null;
  readonly sessionId: SessionId;
}

export interface OneRuntimeEventPerSessionRowInput extends SerializedSessionRuntimeEventInput {
  readonly projection: SessionRuntimeEventProjection;
  readonly sessionId: SessionId;
}

export interface PersistOneRuntimeEventPerSessionResult {
  readonly persistedCount: number;
  readonly skippedSessionIds: readonly SessionId[];
}

export interface SessionRuntimeEventSourceReceipt {
  readonly eventId: string;
  readonly seq: number;
  readonly type: string;
}

export interface SessionEventInsertValue {
  readonly agentId: AgentId;
  readonly contentText: string;
  readonly createdAt: number;
  readonly endedAt: number;
  readonly eventType: string;
  readonly family: SessionRuntimeEventProjection["family"];
  readonly id: RuntimeEventId;
  readonly occurredAt: number;
  readonly processStatus: SessionRuntimeEventProjection["processStatus"];
  readonly processType: SessionRuntimeEventProjection["processType"];
  readonly runId: SessionRunId | null;
  readonly seq: number;
  readonly sessionId: SessionId;
  readonly source: SessionRuntimeEventProjection["source"];
  readonly sourceEventId: string;
  readonly tokens: number | null;
  readonly traceId: string | null;
  readonly visibility: SessionRuntimeEventProjection["visibility"];
}

export interface InsertSessionEventResult {
  readonly insertedCount: number;
  readonly insertedRows: readonly {
    readonly sessionId: SessionId;
    readonly sourceEventId: string;
  }[];
  readonly insertedSessionIds: readonly SessionId[];
  readonly insertedSourceEventIds: readonly string[];
}
