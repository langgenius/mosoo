import type { AgentBuiltInToolConfig, AgentKind } from "../agent/agent.contract";
import type { FileUploadSummary } from "../file/file.contract";
import type {
  AgentDeploymentVersionId,
  AgentId,
  CredentialId,
  FileId,
  McpServerId,
  PlatformId,
  AppId,
  RuntimeEventId,
  SessionId,
  SessionMessageId,
  SessionRunId,
  SkillId,
  SkillSnapshotId,
} from "../id/id.contract";
import type { AgentMcpCredentialMode } from "../mcp/mcp.contract";
import type { SessionRunSummary, UserWarning } from "./session-run.contract";

export const SESSION_STATUSES = ["IDLE", "RUNNING", "RESCHEDULING", "TERMINATED"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const SESSION_TYPES = ["api_channel", "preview", "ui"] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

export interface SessionSummary {
  agentId: AgentId;
  archivedAt: string | null;
  createdAt: string;
  deploymentVersionId: AgentDeploymentVersionId | null;
  deploymentVersionNumber: number | null;
  id: SessionId;
  kind: AgentKind;
  lastMessageAt?: string | null;
  lastRun: SessionRunSummary | null;
  model: string;
  provider: string;
  runtimeId: string;
  status: SessionStatus;
  title: string | null;
  type: SessionType;
  updatedAt: string;
  appId: AppId;
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
  agentId: AgentId;
  deploymentVersionId: AgentDeploymentVersionId | null;
  deploymentVersionNumber: number | null;
  kind: AgentKind;
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

export type SessionProcessEventTypeCode =
  (typeof SESSION_PROCESS_EVENT_TYPE_CODES)[SessionProcessEventType];

export const SESSION_PROCESS_EVENT_TYPE_BY_CODE = {
  agent_message_delta: "agent.message.delta",
  agent_thinking_delta: "agent.thinking.delta",
  file_changed: "file.changed",
  run_completed: "run.completed",
  run_failed: "run.failed",
  run_started: "run.started",
  session_status: "session.status",
  session_files_updated: "session_files.updated",
  tool_confirmation_required: "tool.confirmation.required",
  tool_use_completed: "tool.use.completed",
  tool_use_started: "tool.use.started",
  usage_updated: "usage.updated",
  user_message: "user.message",
} as const satisfies Record<SessionProcessEventTypeCode, SessionProcessEventType>;

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

export const SESSION_RUNTIME_EVENT_FAMILIES = [
  "config",
  "diagnostics",
  "driver",
  "file",
  "input",
  "lifecycle",
  "message",
  "permission",
  "provisioning",
  "resource",
  "run",
  "sandbox",
  "state",
  "tool",
  "transport",
  "usage",
] as const;

export type SessionRuntimeEventFamily = (typeof SESSION_RUNTIME_EVENT_FAMILIES)[number];

export const SESSION_RUNTIME_EVENT_SOURCES = ["api", "driver", "file", "system", "viewer"] as const;

export type SessionRuntimeEventSource = (typeof SESSION_RUNTIME_EVENT_SOURCES)[number];

export const SESSION_RUNTIME_EVENT_VISIBILITIES = ["all_consumers", "owner_debug"] as const;

export type SessionRuntimeEventVisibility = (typeof SESSION_RUNTIME_EVENT_VISIBILITIES)[number];

export interface SessionFile {
  committed: boolean;
  createdAt: string;
  id: FileId;
  kind: "artifact" | "attachment";
  mimeType: string | null;
  name: string;
  size: number;
}

export interface SessionResource {
  createdAt: string;
  id: FileId;
  kind: "artifact" | "attachment";
  mimeType: string | null;
  name: string;
  path: string;
  size: number;
}

export interface AddSessionResourceInput {
  file: {
    contentType: string;
    name: string;
    size: number;
  };
  appId: AppId;
  sessionId: SessionId;
}

export interface RemoveSessionResourceInput {
  appId: AppId;
  resourceId: FileId;
  sessionId: SessionId;
}

export type AddSessionResourceResult = FileUploadSummary;

export interface CreateAgentSessionInput {
  agentId: AgentId;
  appId: AppId;
  type?: SessionType | null;
  waitForRuntimeReady?: boolean | null;
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

export interface StartAgentRunInput {
  agentId?: AgentId | null;
  appId: AppId;
  clientRequestId?: string | null;
  prompt: string;
  sessionId?: SessionId | null;
  type?: SessionType | null;
  waitForRuntimeReady?: boolean | null;
}

export interface AgentRunEventSurface {
  appId: AppId;
  graphqlUrl: string;
  messagesOperation: "threadSessionMessages";
  processEventsOperation: "threadSessionProcessEvents";
  retrieveOperation: "threadAgentSessionRetrieve";
  sessionId: SessionId;
  streamUrl: string | null;
  suggestedPollIntervalMs: number;
}

export interface AgentRunWorkflow {
  acceptedAt: string;
  createdSession: boolean;
  eventBatch: AgentSessionEventBatch;
  eventSurface: AgentRunEventSurface;
  run: SessionRunSummary | null;
  session: SessionSummary;
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

export const AGENT_SESSION_USER_LIFECYCLE_STATES = ["alive", "asleep", "buried"] as const;
export type AgentSessionUserLifecycleState = (typeof AGENT_SESSION_USER_LIFECYCLE_STATES)[number];

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

export function hasAgentSessionArchiveMarker(value: number | string | null | undefined): boolean {
  return value !== null && value !== undefined && value !== "";
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

  if (hasAgentSessionArchiveMarker(session.archivedAt)) {
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
  "list_session_resources",
  "permission_decision",
  "remove_session_resource",
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

export interface RenameSessionInput {
  appId: AppId;
  sessionId: SessionId;
  title: string;
}
