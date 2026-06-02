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
export const PUBLISHED_AGENT_API_PREFIX = "/v1";
export const PUBLIC_API_VERSION = "v1";
export const PUBLISHED_THREAD_INPUT_TEXT_MAX_LENGTH = 32_000;
export const PUBLISHED_THREAD_CLIENT_EXTERNAL_REF_MAX_LENGTH = 255;
export const PUBLISHED_THREAD_FILE_ID_MAX_LENGTH = 26;
export const PUBLISHED_THREAD_ID_PATTERN = PLATFORM_ID_INPUT_PATTERN;
export const PUBLISHED_THREAD_JSON_BODY_MAX_BYTES = PUBLISHED_THREAD_INPUT_TEXT_MAX_LENGTH + 8192;
export const PUBLISHED_AGENT_THREADS_MAX_LIMIT = 100;
export const PUBLISHED_THREAD_EVENTS_DEFAULT_LIMIT = 100;
export const PUBLISHED_THREAD_EVENTS_MAX_LIMIT = 1000;
export const PUBLISHED_THREAD_EVENT_LOG_TYPES = SESSION_PROCESS_EVENT_TYPES;
export type PublishedThreadEventLogType = SessionProcessEventType;
export const PUBLISHED_THREAD_EVENT_LOG_STATUSES = SESSION_PROCESS_EVENT_STATUSES;
export type PublishedThreadEventLogStatus = SessionProcessEventStatus;

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

export type PublishedRunStatus =
  | "booting"
  | "cancelled"
  | "completed"
  | "expired"
  | "failed"
  | "queued"
  | "running"
  | "waiting_input";

export type PublishedRunTrigger = "resume" | "retry" | "system" | "user_prompt";

export interface PublishedRunSummary {
  completedAt: string | null;
  createdAt: string;
  id: SessionRunId;
  startedAt: string | null;
  status: PublishedRunStatus;
  trigger: PublishedRunTrigger;
  updatedAt: string;
}

export type PublishedThreadEventType = "permission_decision" | "user_interrupt" | "user_message";

export type PublishedThreadPermissionDecision = "allow_once" | "reject_once";

export type PublishedThreadEventInput =
  | {
      attachmentIds?: FileId[];
      clientRequestId?: string | null;
      text: string;
      type: "user_message";
    }
  | {
      decision: PublishedThreadPermissionDecision;
      requestId: string;
      type: "permission_decision";
    }
  | {
      runId?: SessionRunId | null;
      type: "user_interrupt";
    };

export interface PublishedThreadEventResult {
  clientRequestId: string | null;
  run: PublishedRunSummary | null;
  type: PublishedThreadEventType;
}

export interface PublishedThreadCallerSummary {
  id: PlatformId;
  kind: "human_pat" | "service_token";
}

export interface PublishedThreadAttributedUserSummary {
  id: AccountId;
}

export type PublishedThreadStatus = "IDLE" | "RESCHEDULING" | "RUNNING" | "TERMINATED";

export interface PublishedThreadSummary {
  agent_id: AgentId;
  attributed_user: PublishedThreadAttributedUserSummary | null;
  client_external_ref: string | null;
  created_at: string;
  created_by: PublishedThreadCallerSummary;
  id: PublicThreadId;
  kind: AgentKind;
  last_run_id: SessionRunId | null;
  source: "api";
  status: PublishedThreadStatus;
  title: string | null;
  updated_at: string;
}

export interface PublishedThreadLinks {
  thread: string;
}

export interface PublishedAgentCreateThreadResponse {
  links: PublishedThreadLinks;
  run: PublishedRunSummary;
  thread: PublishedThreadSummary;
}

export interface PublishedAgentRetrieveThreadResponse {
  links: PublishedThreadLinks;
  run: PublishedRunSummary | null;
  thread: PublishedThreadSummary;
}

export interface PublishedAgentListThreadsResponse {
  threads: PublishedThreadSummary[];
}

export interface PublishedAgentSendEventsRequest {
  events: PublishedThreadEventInput[];
}

export interface PublishedAgentSendEventsResponse {
  acceptedAt: string;
  events: PublishedThreadEventResult[];
  thread: PublishedThreadSummary;
  warnings: UserWarning[];
}

export interface PublishedThreadEventLogEntry {
  content: string;
  durationMs: number | null;
  id: RuntimeEventId;
  occurredAt: string;
  status: PublishedThreadEventLogStatus;
  tokens: number | null;
  type: PublishedThreadEventLogType;
}

export interface PublishedAgentListThreadEventsResponse {
  events: PublishedThreadEventLogEntry[];
  truncated: boolean;
}

export interface CreatePublishedThreadFileRequest {
  fileId: FileId;
}

export interface PublishedThreadFile {
  committed: boolean;
  createdAt: string;
  id: FileId;
  kind: "artifact" | "attachment";
  mimeType: string | null;
  name: string;
  size: number;
}

export interface PublishedThreadFileResponse {
  file: PublishedThreadFile;
}

export interface PublishedThreadFileListResponse {
  files: PublishedThreadFile[];
}
