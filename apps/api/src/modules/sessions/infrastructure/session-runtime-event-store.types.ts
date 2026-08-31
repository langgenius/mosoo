import type { AgentTaskSnapshot } from "@mosoo/contracts/session";
import type {
  AgentId,
  DriverCommandId,
  DriverInstanceId,
  RuntimeEventId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";

import type { createSessionRuntimeEventProjection } from "../domain/session-runtime-event-projection";

type SessionRuntimeEventProjection = ReturnType<typeof createSessionRuntimeEventProjection>;

export interface PersistSessionRuntimeEventsInput {
  readonly driverFence?: DriverRuntimeEventFence;
  records: readonly SessionRuntimeEventInput[];
  readonly sessionId: SessionId;
}

export interface DriverRuntimeEventFence {
  readonly connectionId: string;
  readonly driverInstanceId: DriverInstanceId;
  readonly generation: number;
  readonly sessionRunId: SessionRunId | null;
}

export interface PersistSessionRuntimeEventsResult {
  readonly persistedCount: number;
  readonly persistedEvents: readonly SessionRuntimeEventRecord[];
  readonly persistedSourceEventIds: readonly string[];
}

export interface SessionRuntimeEventInput {
  readonly artifactAttemptId?: string | null;
  readonly artifactManifestJson?: string | null;
  readonly artifactManifestSha256?: string | null;
  readonly event: SessionRuntimeEventRecord;
  readonly occurredAt: number | null;
  readonly provenMcpCommandId?: DriverCommandId | null;
  readonly sourceEventId: string | null;
}

export type SessionRuntimeEventRecord = RuntimeEventEnvelope;

export interface SerializedSessionRuntimeEventInput {
  readonly artifactAttemptId: string | null;
  readonly artifactManifestJson: string | null;
  readonly artifactManifestSha256: string | null;
  readonly event: SessionRuntimeEventRecord;
  readonly occurredAt: number | null;
  readonly provenMcpCommandId: DriverCommandId | null;
  readonly semanticHash: string;
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
  readonly previousCursor: number;
}

export interface OneRuntimeEventPerSessionAllocation {
  readonly agentId: AgentId;
  readonly previousCursor: number;
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
  readonly semanticHash: string | null;
  readonly seq: number;
  readonly type: string;
}

export interface SessionEventInsertValue {
  readonly agentTaskSnapshot: AgentTaskSnapshot | null;
  readonly agentId: AgentId;
  readonly artifactAttemptId: string | null;
  readonly artifactManifestJson: string | null;
  readonly artifactManifestSha256: string | null;
  readonly contentText: string;
  readonly createdAt: number;
  readonly endedAt: number;
  readonly event: SessionRuntimeEventRecord;
  readonly eventType: string;
  readonly family: SessionRuntimeEventProjection["family"];
  readonly id: RuntimeEventId;
  readonly mcpCommandId: DriverCommandId | null;
  readonly occurredAt: number;
  readonly processStatus: SessionRuntimeEventProjection["processStatus"];
  readonly processType: SessionRuntimeEventProjection["processType"];
  readonly runId: SessionRunId | null;
  readonly runtimeOperationEventJson: string | null;
  readonly semanticHash: string;
  readonly terminalEventJson: string | null;
  readonly seq: number;
  readonly sessionId: SessionId;
  readonly source: SessionRuntimeEventProjection["source"];
  readonly sourceEventId: string;
  readonly streamId: string | null;
  readonly toolCallId: string | null;
  readonly toolInputDeltaJson: string | null;
  readonly toolInputJson: string | null;
  readonly toolName: string | null;
  readonly toolOutputDeltaText: string | null;
  readonly toolOutputText: string | null;
  readonly toolParentMessageId: string | null;
  readonly toolResultMessageId: string | null;
  readonly toolStatus: SessionRuntimeEventProjection["toolStatus"];
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
