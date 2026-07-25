export interface SessionViewPlanEntry {
  content: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed";
}

export type SessionViewSegment =
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "reasoning";
      text: string;
    }
  | {
      argsText: string;
      kind: "tool_use";
      path: string | null;
      tool: string;
      toolCallId: string;
    }
  | {
      kind: "tool_result";
      output: string;
      tool: string;
      toolCallId: string;
    };

export interface SessionViewMessage {
  content: string;
  createdAt: string;
  id: string;
  plan: SessionViewPlanEntry[];
  role: "assistant" | "user";
  segments: SessionViewSegment[];
}

export type SessionLiveStateMessage = SessionViewMessage;

export interface SessionViewFile {
  committed: boolean;
  createdAt: string;
  id: string;
  kind: "artifact" | "attachment";
  mimeType: string | null;
  name: string;
  size: number;
}

export interface SessionPermissionRequestView {
  driverInstanceId: string;
  rawInput: string | null;
  requestId: string;
  runId: string;
  title: string;
  toolCallId: string | null;
  toolKind: string | null;
}

export type SessionLifecycleStatus = "IDLE" | "RUNNING" | "RESCHEDULING" | "TERMINATED";

export interface SessionReadinessIssueView {
  code: string;
  fixHref?: string | null;
  message: string;
  severity: "error" | "warning";
}

export interface SessionReadinessSnapshotView {
  checkedAt: string;
  issues: SessionReadinessIssueView[];
  ready: boolean;
}

export interface SessionInfraState {
  lastFailureReason: string | null;
  lastFailureMessage: string | null;
  lastSeen: string | null;
  reconnecting: boolean;
}

export interface SessionCommandOptionInput {
  hint: string;
  kind: "unstructured";
}

export interface SessionCommandOption {
  description: string;
  input?: SessionCommandOptionInput | null;
  name: string;
}

export interface SessionModeOption {
  description?: string | null;
  id: string;
  name: string;
}

export interface SessionConfigValueOption {
  description?: string | null;
  group?: string | null;
  groupName?: string | null;
  name: string;
  value: string;
}

export interface SessionConfigOption {
  category?: string | null;
  currentValue: string;
  description?: string | null;
  id: string;
  name: string;
  type: "select";
  values: SessionConfigValueOption[];
}

export interface SessionUsageSummary {
  cachedReadTokens?: number | null;
  cachedWriteTokens?: number | null;
  callId?: string | null;
  costAmount?: number | null;
  costCurrency?: string | null;
  inputTokens?: number | null;
  model?: string | null;
  outputTokens?: number | null;
  provider?: string | null;
  size?: number | null;
  source: "prompt_response" | "session_update";
  thoughtTokens?: number | null;
  totalTokens?: number | null;
  usageContract?:
    | "anthropic_bucketed"
    | "openai_runtime_total_with_cached_breakdown"
    | "openai_total_with_cached_breakdown";
  used?: number | null;
}

export interface SessionRunView {
  completedAt: string | null;
  error: {
    code: string;
    details: Record<string, string | number | boolean | null>;
    message: string;
    retryable: boolean;
  } | null;
  id: string | null;
  startedAt: string | null;
  status:
    | "idle"
    | "queued"
    | "booting"
    | "running"
    | "waiting_input"
    | "completed"
    | "failed"
    | "cancelled"
    | "expired";
  traceId: string | null;
}

export interface SessionLiveState {
  commands: SessionCommandOption[];
  configOptions: SessionConfigOption[];
  currentModeId: string | null;
  files: SessionViewFile[];
  infra: SessionInfraState;
  lifecycle: SessionLifecycleStatus;
  messages: SessionViewMessage[];
  permissionRequests: SessionPermissionRequestView[];
  plan: SessionViewPlanEntry[];
  readiness: SessionReadinessSnapshotView | null;
  run: SessionRunView;
  sessionId: string;
  title: string | null;
  updatedAt: string | null;
  usage: SessionUsageSummary | null;
  viewerId: string;
  visibleModes: SessionModeOption[];
}

export function isSessionLiveStateStreaming(
  state: Pick<SessionLiveState, "lifecycle"> | null,
): boolean {
  return state?.lifecycle === "RUNNING";
}

export interface JsonPatchOperation {
  op: "add" | "remove" | "replace";
  path: string;
  value?: unknown;
}
