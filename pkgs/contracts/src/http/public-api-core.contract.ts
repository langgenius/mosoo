import { PLATFORM_ID_INPUT_PATTERN } from "@mosoo/id";
import type {
  AccountId,
  AgentId,
  FileId,
  PlatformId,
  PublicThreadId,
  RuntimeEventId,
  SessionRunId,
} from "@mosoo/id";

import type { AgentKind } from "../agent/agent.contract";
import { SINGLE_PUT_THRESHOLD_BYTES } from "../file/file.contract";
import type { CreateFileUploadRequest } from "../file/file.contract";
import type { UserWarning } from "../session/session-run.contract";
import {
  SESSION_PROCESS_EVENT_STATUSES,
  SESSION_PROCESS_EVENT_TYPES,
} from "../session/session.contract";
import type {
  SessionProcessEventStatus,
  SessionProcessEventType,
} from "../session/session.contract";

export const PUBLIC_API_PREFIX = "/api";
export const PUBLIC_API_VERSION_PREFIX = "/v1";
export const PUBLIC_API_VERSION = "v1";
export const PUBLIC_THREAD_INPUT_TEXT_MAX_LENGTH = 32_000;
export const PUBLIC_THREAD_CLIENT_EXTERNAL_REF_MAX_LENGTH = 255;
export const PUBLIC_THREAD_FILE_ID_MAX_LENGTH = 26;
export const PUBLIC_THREAD_FILE_UPLOAD_MAX_BYTES = SINGLE_PUT_THRESHOLD_BYTES;
export const PUBLIC_THREAD_ID_PATTERN = PLATFORM_ID_INPUT_PATTERN;
export const PUBLIC_THREAD_JSON_BODY_MAX_BYTES = PUBLIC_THREAD_INPUT_TEXT_MAX_LENGTH + 8192;
export const PUBLIC_THREAD_API_THREADS_MAX_LIMIT = 100;
export const PUBLIC_THREAD_EVENTS_DEFAULT_LIMIT = 100;
export const PUBLIC_THREAD_EVENTS_MAX_LIMIT = 1000;
export const PUBLIC_THREAD_EVENT_LOG_TYPES = SESSION_PROCESS_EVENT_TYPES;
export type PublicThreadEventLogType = SessionProcessEventType;
export const PUBLIC_THREAD_EVENT_LOG_STATUSES = SESSION_PROCESS_EVENT_STATUSES;
export type PublicThreadEventLogStatus = SessionProcessEventStatus;

export const PUBLIC_API_ERROR_CODES = [
  "agent_not_published",
  "forbidden",
  "idempotency_conflict",
  "internal_error",
  "invalid_json",
  "invalid_request",
  "not_found",
  "rate_limited",
  "readiness_blocked",
  "service_inactive",
  "unauthenticated",
] as const;

export type PublicApiErrorCode = (typeof PUBLIC_API_ERROR_CODES)[number];

export interface PublicApiErrorPayload {
  code: PublicApiErrorCode;
  message: string;
}

export interface PublicApiErrorResponse {
  error: PublicApiErrorPayload;
}

export type PublicThreadRunStatus =
  | "booting"
  | "cancelled"
  | "completed"
  | "expired"
  | "failed"
  | "queued"
  | "running"
  | "waiting_input";

export type PublicThreadRunTrigger = "resume" | "retry" | "system" | "user_prompt";

export const PUBLIC_THREAD_RUN_TERMINAL_STATUSES = [
  "completed",
  "failed",
  "cancelled",
  "expired",
] as const;

export type PublicThreadRunTerminalStatus = (typeof PUBLIC_THREAD_RUN_TERMINAL_STATUSES)[number];

export interface PublicThreadFinalOutput {
  text: string;
}

export interface PublicThreadRunError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface PublicThreadRunSummary {
  completedAt: string | null;
  createdAt: string;
  error: PublicThreadRunError | null;
  finalOutput: PublicThreadFinalOutput | null;
  id: SessionRunId;
  startedAt: string | null;
  status: PublicThreadRunStatus;
  trigger: PublicThreadRunTrigger;
  updatedAt: string;
}

export type PublicThreadEventType = "permission_decision" | "user_interrupt" | "user_message";

export type PublicThreadPermissionDecision = "allow_once" | "reject_once";

export type PublicThreadEventInput =
  | {
      attachmentIds?: FileId[];
      clientRequestId?: string | null;
      text: string;
      type: "user_message";
    }
  | {
      decision: PublicThreadPermissionDecision;
      requestId: string;
      type: "permission_decision";
    }
  | {
      runId?: SessionRunId | null;
      type: "user_interrupt";
    };

export interface PublicThreadEventResult {
  clientRequestId: string | null;
  run: PublicThreadRunSummary | null;
  type: PublicThreadEventType;
}

export interface PublicThreadCallerSummary {
  id: PlatformId;
  kind: "access_token";
}

export interface PublicThreadAttributedUserSummary {
  id: AccountId;
}

export type PublicThreadStatus = "IDLE" | "RESCHEDULING" | "RUNNING" | "TERMINATED";

export interface PublicThreadSummary {
  agent_id: AgentId;
  attributed_user: PublicThreadAttributedUserSummary | null;
  client_external_ref: string | null;
  created_at: string;
  created_by: PublicThreadCallerSummary;
  id: PublicThreadId;
  kind: AgentKind;
  last_run_id: SessionRunId | null;
  source: "api";
  status: PublicThreadStatus;
  title: string | null;
  updated_at: string;
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

export interface PublicThreadApiListThreadsResponse {
  threads: PublicThreadSummary[];
}

export interface PublicThreadApiSendEventsRequest {
  events: PublicThreadEventInput[];
}

export interface PublicThreadApiSendEventsResponse {
  acceptedAt: string;
  events: PublicThreadEventResult[];
  thread: PublicThreadSummary;
  warnings: UserWarning[];
}

export interface PublicThreadEventLogEntry {
  content: string;
  durationMs: number | null;
  id: RuntimeEventId;
  occurredAt: string;
  runId: SessionRunId | null;
  status: PublicThreadEventLogStatus;
  tokens: number | null;
  type: PublicThreadEventLogType;
}

export interface PublicThreadApiListThreadEventsResponse {
  events: PublicThreadEventLogEntry[];
  truncated: boolean;
}

export interface CreatePublicThreadFileRequest {
  fileId: FileId;
}

export interface CreatePublicThreadFileUploadRequest {
  file: CreateFileUploadRequest["file"];
}

export interface PublicThreadFile {
  committed: boolean;
  createdAt: string;
  id: FileId;
  kind: "artifact" | "attachment";
  mimeType: string | null;
  name: string;
  size: number;
}

export interface PublicThreadFileResponse {
  file: PublicThreadFile;
}

export interface PublicThreadFileListResponse {
  files: PublicThreadFile[];
}
