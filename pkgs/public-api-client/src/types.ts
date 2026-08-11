export const PUBLIC_THREAD_EVENTS_MAX_LIMIT = 1_000;

export const PUBLIC_THREAD_RUN_TERMINAL_STATUSES = [
  "completed",
  "failed",
  "cancelled",
  "expired",
] as const;

export type PublicApiErrorCode =
  | "agent_not_published"
  | "forbidden"
  | "idempotency_conflict"
  | "internal_error"
  | "invalid_json"
  | "invalid_request"
  | "not_found"
  | "rate_limited"
  | "readiness_blocked"
  | "service_inactive"
  | "unauthenticated";

export type PublicThreadRunStatus =
  | "booting"
  | "cancelled"
  | "completed"
  | "expired"
  | "failed"
  | "queued"
  | "running"
  | "waiting_input";

export type PublicThreadRunTerminalStatus = (typeof PUBLIC_THREAD_RUN_TERMINAL_STATUSES)[number];

export type PublicThreadRunTrigger = "resume" | "retry" | "system" | "user_prompt";

export interface PublicThreadFinalOutputWarning {
  code: "unresolved_provider_citation";
  count: number;
}

export interface PublicThreadFinalOutput {
  text: string;
  warnings?: PublicThreadFinalOutputWarning[];
}

export interface PublicThreadArtifact {
  createdAt: string;
  fileId: string;
  kind: "artifact";
  mimeType: string | null;
  name: string;
  runId: string;
  size: number;
}

export interface PublicThreadRunError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface PublicThreadRunSummary {
  artifacts?: PublicThreadArtifact[];
  completedAt: string | null;
  createdAt: string;
  error: PublicThreadRunError | null;
  finalOutput: PublicThreadFinalOutput | null;
  id: string;
  startedAt: string | null;
  status: PublicThreadRunStatus;
  trigger: PublicThreadRunTrigger;
  updatedAt: string;
}

export type PublicThreadStatus = "IDLE" | "RESCHEDULING" | "RUNNING" | "TERMINATED";

export interface PublicThreadSummary {
  agent_id: string;
  created_at: string;
  id: string;
  kind: "cattle" | "pet";
  last_run_id: string | null;
  source: "api";
  status: PublicThreadStatus;
  title: string | null;
  updated_at: string;
  userId: string;
}

export interface PublicThreadLinks {
  thread: string;
}

export interface PublicThreadApiCreateThreadResponse {
  links: PublicThreadLinks;
  run: PublicThreadRunSummary | null;
  thread: PublicThreadSummary;
}

export interface PublicThreadApiRetrieveThreadResponse {
  links: PublicThreadLinks;
  run: PublicThreadRunSummary | null;
  thread: PublicThreadSummary;
}

export interface PublicThreadFileResourceInput {
  file_id: string;
  type: "file";
}

export type PublicThreadPermissionDecision = "allow_once" | "reject_once";

export type PublicThreadEventInput =
  | {
      requestId?: string | null;
      resources?: PublicThreadFileResourceInput[];
      text: string;
      type: "user_message";
    }
  | {
      decision: PublicThreadPermissionDecision;
      requestId: string;
      type: "permission_decision";
    }
  | {
      runId?: string | null;
      type: "user_interrupt";
    };

export interface PublicThreadApiSendEventsRequest {
  events: PublicThreadEventInput[];
}

export type PublicThreadEventType = "permission_decision" | "user_interrupt" | "user_message";

export interface PublicThreadEventResult {
  requestId: string | null;
  run: PublicThreadRunSummary | null;
  type: PublicThreadEventType;
}

export interface PublicThreadUserWarning {
  code: string;
  message: string;
}

export interface PublicThreadApiSendEventsResponse {
  acceptedAt: string;
  events: PublicThreadEventResult[];
  thread: PublicThreadSummary;
  warnings: PublicThreadUserWarning[];
}

export type PublicThreadEventLogType =
  | "agent.message.delta"
  | "agent.thinking.delta"
  | "file.changed"
  | "run.completed"
  | "run.failed"
  | "run.started"
  | "session.status"
  | "session_files.updated"
  | "tool.confirmation.required"
  | "tool.use.completed"
  | "tool.use.started"
  | "usage.updated"
  | "user.message";

export type PublicThreadEventLogStatus = "available" | "error" | "unsupported";

export interface PublicThreadEventLogEntry {
  artifact?: PublicThreadArtifact;
  content: string;
  durationMs: number | null;
  id: string;
  occurredAt: string;
  runId: string | null;
  status: PublicThreadEventLogStatus;
  tokens: number | null;
  type: PublicThreadEventLogType;
}

export interface PublicThreadApiListThreadEventsResponse {
  events: PublicThreadEventLogEntry[];
  truncated: boolean;
}

export interface PublicFile {
  createdAt: string;
  id: string;
  mimeType: string | null;
  name: string;
  size: number;
}

export interface PublicFileResponse {
  file: PublicFile;
}

export interface PublicThreadFile {
  committed: boolean;
  createdAt: string;
  fileId?: string;
  id: string;
  kind: "artifact" | "attachment";
  mimeType: string | null;
  name: string;
  runId?: string | null;
  size: number;
}

export interface PublicThreadFileListResponse {
  files: PublicThreadFile[];
}
