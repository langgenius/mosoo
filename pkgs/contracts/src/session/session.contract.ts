import type {
  AgentDeploymentVersionId,
  AgentId,
  CredentialId,
  FileId,
  McpServerId,
  PlatformId,
  ProjectId,
  RuntimeEventId,
  SessionId,
  SessionMessageId,
  SessionRunId,
  SkillId,
  SkillSnapshotId,
} from "@mosoo/id";

import type { AgentBuiltInToolConfig } from "../agent/agent.contract";
import type { FileUploadSummary } from "../file/file.contract";
import type { AgentMcpCredentialMode } from "../mcp/mcp.contract";
import type { SessionRunSummary, UserWarning } from "./session-run.contract";

export const SESSION_STATUSES = ["IDLE", "RUNNING", "RESCHEDULING", "TERMINATED"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const SESSION_TYPES = ["preview", "ui"] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

export type SessionRuntimeOperationName = "restartDriver" | "recreateSandbox";

export interface SessionRuntimeOperationInput {
  projectId: ProjectId;
  sessionId: SessionId;
}

export interface SessionRuntimeOperationResult {
  ok: boolean;
  sessionId: SessionId;
}

export interface SessionSummary {
  /** Optional reusable preset; Project owns every Session. */
  agentId: AgentId | null;
  archivedAt: string | null;
  createdAt: string;
  deploymentVersionId: AgentDeploymentVersionId | null;
  deploymentVersionNumber: number | null;
  id: SessionId;
  lastMessageAt?: string | null;
  lastRun: SessionRunSummary | null;
  model: string;
  provider: string;
  runtimeId: string;
  status: SessionStatus;
  title: string | null;
  type: SessionType;
  updatedAt: string;
  projectId: ProjectId;
}

export interface SessionListPageInfo {
  endCursor: string | null;
  hasMore: boolean;
  startCursor: string | null;
}

export interface SessionSummaryConnection {
  nodes: SessionSummary[];
  pageInfo: SessionListPageInfo;
}

export interface SessionExecutionBinding {
  agentId: AgentId | null;
  deploymentVersionId: AgentDeploymentVersionId | null;
  deploymentVersionNumber: number | null;
  model: string;
  prompt: string;
  provider: string;
  runtimeId: string;
  sessionId: SessionId;
}

export interface SessionExecutionSkillReference {
  resolutionMode: "auto" | "explicit" | "tombstone";
  sessionId: SessionId;
  skillId: SkillId;
  skillName: string;
  snapshotId: SkillSnapshotId | null;
  sortOrder: number;
}

export interface SessionExecutionToolReference {
  agentCredentialId: CredentialId | null;
  credentialMode: AgentMcpCredentialMode;
  serverId: McpServerId;
  sessionId: SessionId;
  sortOrder: number;
}

/**
 * One entry on the assistant-turn timeline, in the order the agent
 * emitted it. Tool calls arrive as a pair of segments (tool_use then
 * tool_result) whose toolCallId matches; pair them only for UX, never
 * reorder — the point of this array is to preserve real arrival order
 * so text and tools render interleaved.
 */
export type SessionMessageSegment =
  | { kind: "text"; text: string }
  | {
      argsText: string;
      kind: "tool_use";
      path: string | null;
      tool: string;
      toolCallId: string;
    }
  | { kind: "tool_result"; output: string; tool: string; toolCallId: string };

/**
 * The agent's current understanding of its work-to-do for this assistant
 * turn. Populated from either a native plan notification or a markdown
 * checkbox list extracted from the assistant's text.
 */
export interface SessionMessagePlanEntry {
  content: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed";
}

export interface SessionMessage {
  content: string;
  createdAt: string;
  createdBy: PlatformId;
  id: SessionMessageId;
  plan: SessionMessagePlanEntry[];
  role: "assistant" | "user";
  segments: SessionMessageSegment[];
}

export const SESSION_PROCESS_EVENT_TYPES = [
  "agent.message.delta",
  "agent.thinking.delta",
  "file.changed",
  "run.completed",
  "run.failed",
  "run.started",
  "session.status",
  "session_files.updated",
  "tool.confirmation.required",
  "tool.use.completed",
  "tool.use.started",
  "usage.updated",
  "user.message",
] as const;

export type SessionProcessEventType = (typeof SESSION_PROCESS_EVENT_TYPES)[number];

export const SESSION_PROCESS_EVENT_TYPE_CODES = {
  "agent.message.delta": "agent_message_delta",
  "agent.thinking.delta": "agent_thinking_delta",
  "file.changed": "file_changed",
  "run.completed": "run_completed",
  "run.failed": "run_failed",
  "run.started": "run_started",
  "session.status": "session_status",
  "session_files.updated": "session_files_updated",
  "tool.confirmation.required": "tool_confirmation_required",
  "tool.use.completed": "tool_use_completed",
  "tool.use.started": "tool_use_started",
  "usage.updated": "usage_updated",
  "user.message": "user_message",
} as const satisfies Record<SessionProcessEventType, string>;

export const SESSION_PROCESS_EVENT_TYPE_BY_CODE = Object.fromEntries(
  Object.entries(SESSION_PROCESS_EVENT_TYPE_CODES).map(([type, code]) => [code, type]),
) as {
  readonly [TType in SessionProcessEventType as (typeof SESSION_PROCESS_EVENT_TYPE_CODES)[TType]]: TType;
};

export const SESSION_PROCESS_EVENT_STATUSES = ["available", "error", "unsupported"] as const;

export type SessionProcessEventStatus = (typeof SESSION_PROCESS_EVENT_STATUSES)[number];

export interface SessionProcessEvent {
  content: string;
  durationMs: number | null;
  id: RuntimeEventId;
  occurredAt: string;
  status: SessionProcessEventStatus;
  tokens: number | null;
  type: SessionProcessEventType;
}

// The synthetic hidden-older-events marker is minted at read time instead of
// being persisted. Its id must be a valid platform ULID (the GraphQL ULID
// scalar validates output) AND deterministic per session: readers poll this
// projection and key turn grouping and drawer selection off event ids, so a
// fresh random id per read makes every poll drop UI state. The id reuses the
// session ULID's 10-char time prefix plus a fixed Crockford-base32 tail that a
// random event tail cannot realistically collide with.

const SYNTHETIC_PROCESS_EVENT_TIME_PREFIX_LENGTH = 10;
const PROCESS_EVENTS_TRUNCATED_EVENT_ID_TAIL = "0EVENTSCAPPED000";

export function createProcessEventsTruncatedEventId(sessionId: SessionId): RuntimeEventId {
  return `${sessionId.slice(0, SYNTHETIC_PROCESS_EVENT_TIME_PREFIX_LENGTH)}${PROCESS_EVENTS_TRUNCATED_EVENT_ID_TAIL}` as RuntimeEventId;
}

export type SessionRuntimeEventVisibility = "all_consumers" | "owner_debug";

export interface SessionFile {
  committed: boolean;
  createdAt: string;
  id: FileId;
  kind: "artifact" | "attachment";
  mimeType: string | null;
  name: string;
  size: number;
}

export interface AddSessionResourceInput {
  file: {
    contentType: string;
    name: string;
    size: number;
  };
  projectId: ProjectId;
  sessionId: SessionId;
}

export type AddSessionResourceResult = FileUploadSummary;

export interface CreateAgentSessionInput {
  agentId: AgentId;
  projectId: ProjectId;
  type?: SessionType | null;
}

export const AGENT_SESSION_EVENT_TYPES = [
  "permission_decision",
  "user_interrupt",
  "user_message",
] as const;
export type AgentSessionEventType = (typeof AGENT_SESSION_EVENT_TYPES)[number];

export const AGENT_SESSION_PERMISSION_DECISIONS = ["allow_once", "reject_once"] as const;
export type AgentSessionPermissionDecision = (typeof AGENT_SESSION_PERMISSION_DECISIONS)[number];

export type AgentSessionEventInput =
  | {
      attachmentIds?: FileId[];
      clientRequestId?: string | null;
      text: string;
      type: "user_message";
    }
  | {
      decision: AgentSessionPermissionDecision;
      requestId: string;
      type: "permission_decision";
    }
  | {
      runId?: SessionRunId | null;
      type: "user_interrupt";
    };

export interface AgentSessionEventResult {
  clientRequestId: string | null;
  run: SessionRunSummary | null;
  type: AgentSessionEventType;
}

export interface AgentSessionEventBatch {
  acceptedAt: string;
  events: AgentSessionEventResult[];
  session: SessionSummary;
  warnings: UserWarning[];
}

export const AGENT_SESSION_RECOVERABILITY_STATUSES = [
  "not_recoverable",
  "read_only",
  "resumable",
] as const;
export type AgentSessionRecoverabilityStatus =
  (typeof AGENT_SESSION_RECOVERABILITY_STATUSES)[number];

export interface AgentSessionRecoverability {
  reason: string | null;
  status: AgentSessionRecoverabilityStatus;
}

export type AgentSessionUserLifecycleState = "alive" | "asleep" | "buried";

export const AGENT_SESSION_ARCHIVED_READ_ONLY_REASON =
  "Session is archived and read-only until it is unarchived.";
export const AGENT_SESSION_TERMINAL_READ_ONLY_REASON =
  "Session is terminated. Create a new session to continue work.";

export interface AgentSessionUserLifecycleProjection {
  readOnly: boolean;
  recoverability: AgentSessionRecoverability;
  state: AgentSessionUserLifecycleState;
  terminal: boolean;
}

export interface AgentSessionUserLifecycleInput {
  archivedAt?: number | string | null;
  status?: SessionStatus;
}

export function getAgentSessionUserLifecycleProjection(
  session: AgentSessionUserLifecycleInput,
): AgentSessionUserLifecycleProjection {
  if (session.status === "TERMINATED") {
    return {
      readOnly: true,
      recoverability: {
        reason: AGENT_SESSION_TERMINAL_READ_ONLY_REASON,
        status: "not_recoverable",
      },
      state: "buried",
      terminal: true,
    };
  }

  if (
    session.archivedAt !== null &&
    session.archivedAt !== undefined &&
    session.archivedAt !== ""
  ) {
    return {
      readOnly: true,
      recoverability: {
        reason: AGENT_SESSION_ARCHIVED_READ_ONLY_REASON,
        status: "read_only",
      },
      state: "asleep",
      terminal: false,
    };
  }

  return {
    readOnly: false,
    recoverability: {
      reason: null,
      status: "resumable",
    },
    state: "alive",
    terminal: false,
  };
}

export interface AgentSessionExecutionDiagnostics {
  binding: SessionExecutionBinding;
  builtInTools: AgentBuiltInToolConfig[];
  skills: SessionExecutionSkillReference[];
  tools: SessionExecutionToolReference[];
}

export interface AgentSessionNativeRuntimeRefDiagnostics {
  kind: string | null;
  runtimeId: string | null;
  status: "absent" | "present";
  valuePreview: string | null;
}

export interface AgentSessionDiagnostics {
  execution: AgentSessionExecutionDiagnostics | null;
  generatedAt: string;
  nativeRuntimeRef: AgentSessionNativeRuntimeRefDiagnostics;
  pendingPermissionCount: number;
  session: SessionSummary;
}

export const AGENT_SESSION_ACTION_CAPABILITY_NAMES = [
  "add_session_resource",
  "archive_session",
  "create_session",
  "delete_session",
  "permission_decision",
  "retrieve_session",
  "connect_stream",
  "send_user_message",
  "unarchive_session",
  "user_interrupt",
] as const;
export type AgentSessionActionCapabilityName =
  (typeof AGENT_SESSION_ACTION_CAPABILITY_NAMES)[number];

export const AGENT_SESSION_ACTION_CAPABILITY_STATUSES = [
  "available",
  "degraded",
  "unavailable",
] as const;
export type AgentSessionActionCapabilityStatus =
  (typeof AGENT_SESSION_ACTION_CAPABILITY_STATUSES)[number];

export interface AgentSessionActionCapability {
  action: AgentSessionActionCapabilityName;
  reason: string | null;
  status: AgentSessionActionCapabilityStatus;
}

export interface AgentSessionRetrieveResult {
  capabilities: AgentSessionActionCapability[];
  recoverability: AgentSessionRecoverability;
  session: SessionSummary;
}

export interface AgentSessionRetrieveConnection {
  nodes: AgentSessionRetrieveResult[];
  pageInfo: SessionListPageInfo;
}
