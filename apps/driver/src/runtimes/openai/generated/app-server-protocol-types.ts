export const OPENAI_APP_SERVER_SCHEMA_VERSION = "0.135.0" as const;

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = Readonly<Record<string, unknown>>;

export type RequestId = number | string;
export type ApprovalPolicy = "untrusted" | "on-failure" | "on-request" | "never";
export type ImageDetail = "high" | "original";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type SandboxPolicy = SandboxMode | JsonObject;

export type UserInput =
  | { type: "text"; text: string; text_elements: [] }
  | { type: "image"; detail?: ImageDetail; url: string }
  | { type: "localImage"; detail?: ImageDetail; path: string }
  | { type: "skill"; name: string; path: string }
  | { type: "mention"; name: string; path: string };

export interface InitializeParams {
  capabilities?: {
    experimentalApi?: boolean;
  };
  clientInfo?: {
    name: string;
    title?: string;
    version: string;
  };
}

export interface InitializeResponse {
  protocolVersion?: string;
}

export interface ThreadStartParams {
  approvalPolicy?: ApprovalPolicy | null;
  approvalsReviewer?: string | JsonObject | null;
  baseInstructions?: string | null;
  config?: JsonObject | null;
  cwd?: string | null;
  developerInstructions?: string | null;
  ephemeral?: boolean | null;
  model?: string | null;
  modelProvider?: string | null;
  sandbox?: SandboxMode | null;
  serviceName?: string | null;
  serviceTier?: string | null;
  sessionStartSource?: string | null;
}

export interface ThreadResumeParams extends Omit<
  ThreadStartParams,
  "ephemeral" | "serviceName" | "sessionStartSource"
> {
  threadId: string;
}

export type ThreadActiveFlag = "waitingOnApproval" | "waitingOnUserInput";

export type ThreadStatus =
  | { type: "notLoaded" }
  | { type: "idle" }
  | { type: "systemError" }
  | { type: "active"; activeFlags: ThreadActiveFlag[] };

export interface Thread {
  id: string;
  status?: ThreadStatus;
}

export interface ThreadStartResponse {
  thread: Thread;
}

export interface ThreadResumeResponse {
  thread: Thread;
}

export interface TurnStartParams {
  approvalPolicy?: ApprovalPolicy | null;
  approvalsReviewer?: string | JsonObject | null;
  cwd?: string | null;
  effort?: string | null;
  input: UserInput[];
  model?: string | null;
  outputSchema?: JsonValue | null;
  sandboxPolicy?: SandboxPolicy | null;
  serviceTier?: string | null;
  summary?: string | null;
  threadId: string;
}

export type TurnStatus = "completed" | "interrupted" | "failed" | "inProgress";

export type PatchChangeKind =
  | { type: "add" }
  | { type: "delete" }
  | { move_path: string | null; type: "update" };

export interface FileUpdateChange {
  diff: string;
  kind: PatchChangeKind;
  path: string;
}

export type TurnPlanStepStatus = "pending" | "inProgress" | "completed";

export interface TurnPlanStep {
  status: TurnPlanStepStatus;
  step: string;
}

export type ThreadItem = JsonObject & {
  id?: string;
  type: string;
};

export interface Turn {
  completedAt?: number | null;
  durationMs?: number | null;
  error?: { message?: string } | null;
  id: string;
  items?: ThreadItem[];
  startedAt?: number | null;
  status?: TurnStatus;
}

export interface TurnStartResponse {
  turn: Turn;
}

export interface TurnInterruptParams {
  threadId: string;
  turnId: string;
}

export interface TurnInterruptResponse {
  turn?: Turn;
}

export interface TokenUsageBreakdown {
  cachedInputTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface ThreadTokenUsage {
  last: TokenUsageBreakdown;
  modelContextWindow: number | null;
  total: TokenUsageBreakdown;
}

export interface ItemNotificationBase {
  completedAtMs?: number;
  item?: ThreadItem;
  itemId?: string;
  startedAtMs?: number;
  threadId?: string;
  turnId?: string;
}

export interface PlanDeltaNotification {
  delta: string;
  itemId: string;
  threadId: string;
  turnId: string;
}

export interface TurnPlanUpdatedNotification {
  explanation: string | null;
  plan: TurnPlanStep[];
  threadId: string;
  turnId: string;
}

export interface TurnDiffUpdatedNotification {
  diff: string;
  threadId: string;
  turnId: string;
}

export interface FileChangePatchUpdatedNotification {
  changes: FileUpdateChange[];
  itemId: string;
  threadId: string;
  turnId: string;
}

export interface ReasoningTextDeltaNotification {
  delta: string;
  itemId: string;
  threadId: string;
  turnId: string;
}

export interface ReasoningSummaryPartAddedNotification {
  itemId: string;
  part: string;
  threadId: string;
  turnId: string;
}

export interface ReasoningSummaryTextDeltaNotification {
  delta: string;
  itemId: string;
  threadId: string;
  turnId: string;
}

export interface TextPosition {
  column: number;
  line: number;
}

export interface TextRange {
  end: TextPosition;
  start: TextPosition;
}

export interface ConfigWarningNotification {
  details?: string | null;
  path?: string | null;
  range?: TextRange | null;
  summary: string;
}

export interface WarningNotification {
  message: string;
  threadId: string | null;
}

export interface TurnError {
  additionalDetails: string | null;
  message: string;
}

export interface ErrorNotification {
  error: TurnError;
  threadId: string;
  turnId: string;
  willRetry: boolean;
}

export type RemoteControlConnectionStatus = "disabled" | "connecting" | "connected" | "errored";

export interface RemoteControlStatusChangedNotification {
  environmentId?: string | null;
  installationId: string;
  serverName: string;
  status: RemoteControlConnectionStatus;
}

export interface ThreadSettingsUpdatedNotification {
  threadId: string;
  threadSettings: JsonObject;
}

export interface ServerNotificationParams {
  configWarning: ConfigWarningNotification;
  error: ErrorNotification;
  "item/agentMessage/delta": { delta?: string; threadId?: string; turnId?: string };
  "item/commandExecution/outputDelta": {
    delta?: string;
    itemId?: string;
    threadId?: string;
    turnId?: string;
  };
  "item/completed": ItemNotificationBase;
  "item/fileChange/outputDelta": {
    delta?: string;
    itemId?: string;
    threadId?: string;
    turnId?: string;
  };
  "item/fileChange/patchUpdated": FileChangePatchUpdatedNotification;
  "item/plan/delta": PlanDeltaNotification;
  "item/reasoning/summaryPartAdded": ReasoningSummaryPartAddedNotification;
  "item/reasoning/summaryTextDelta": ReasoningSummaryTextDeltaNotification;
  "item/reasoning/textDelta": ReasoningTextDeltaNotification;
  "item/started": ItemNotificationBase;
  "remoteControl/status/changed": RemoteControlStatusChangedNotification;
  "thread/settings/updated": ThreadSettingsUpdatedNotification;
  "thread/started": { thread: Thread };
  "thread/status/changed": { status: ThreadStatus; threadId: string };
  "thread/tokenUsage/updated": { threadId: string; tokenUsage: ThreadTokenUsage; turnId: string };
  "turn/completed": { threadId: string; turn: Turn };
  "turn/diff/updated": TurnDiffUpdatedNotification;
  "turn/plan/updated": TurnPlanUpdatedNotification;
  "turn/started": { threadId: string; turn: Turn };
  warning: WarningNotification;
}

export type ServerNotificationMethod = keyof ServerNotificationParams;

export interface ClientRequestParams {
  initialize: InitializeParams;
  "thread/resume": ThreadResumeParams;
  "thread/start": ThreadStartParams;
  "turn/interrupt": TurnInterruptParams;
  "turn/start": TurnStartParams;
}

export interface ClientRequestResult {
  initialize: InitializeResponse;
  "thread/resume": ThreadResumeResponse;
  "thread/start": ThreadStartResponse;
  "turn/interrupt": TurnInterruptResponse;
  "turn/start": TurnStartResponse;
}

export type ClientRequestMethod = keyof ClientRequestParams;

export interface CommandExecutionRequestApprovalResponse {
  decision: "accept" | "decline" | "cancel";
}

export interface FileChangeRequestApprovalResponse {
  decision: "accept" | "decline" | "cancel";
}

export interface PermissionsRequestApprovalResponse {
  permissions: JsonObject;
  scope: "turn";
  strictAutoReview?: boolean;
}

export interface ServerRequestParams {
  "item/commandExecution/requestApproval": JsonObject;
  "item/fileChange/requestApproval": JsonObject;
  "item/permissions/requestApproval": JsonObject;
}

export interface ServerRequestResult {
  "item/commandExecution/requestApproval": CommandExecutionRequestApprovalResponse;
  "item/fileChange/requestApproval": FileChangeRequestApprovalResponse;
  "item/permissions/requestApproval": PermissionsRequestApprovalResponse;
}

export type ServerRequestMethod = keyof ServerRequestParams;

const SERVER_NOTIFICATION_METHODS = new Set<string>([
  "configWarning",
  "error",
  "item/agentMessage/delta",
  "item/commandExecution/outputDelta",
  "item/completed",
  "item/fileChange/outputDelta",
  "item/fileChange/patchUpdated",
  "item/plan/delta",
  "item/reasoning/summaryPartAdded",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "item/started",
  "remoteControl/status/changed",
  "thread/settings/updated",
  "thread/started",
  "thread/status/changed",
  "thread/tokenUsage/updated",
  "turn/completed",
  "turn/diff/updated",
  "turn/plan/updated",
  "turn/started",
  "warning",
]);

const SERVER_REQUEST_METHODS = new Set<string>([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
]);

export function isServerNotificationMethod(method: string): method is ServerNotificationMethod {
  return SERVER_NOTIFICATION_METHODS.has(method);
}

export function isServerRequestMethod(method: string): method is ServerRequestMethod {
  return SERVER_REQUEST_METHODS.has(method);
}
