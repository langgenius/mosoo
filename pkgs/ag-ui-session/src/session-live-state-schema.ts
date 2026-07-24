import { type } from "arktype";

import {
  NullableString,
  OptionalNullableString,
  OptionalNumber,
} from "./ag-ui-session-schema-primitives";

export const SessionViewPlanEntrySchema = type({
  content: "string",
  priority: '"high" | "medium" | "low"',
  status: '"pending" | "in_progress" | "completed"',
});

export const SessionViewSegmentSchema = type.or(
  type({
    kind: '"text"',
    text: "string",
  }),
  type({
    kind: '"reasoning"',
    text: "string",
  }),
  type({
    argsText: "string",
    kind: '"tool_use"',
    path: NullableString,
    tool: "string",
    toolCallId: "string",
  }),
  type({
    kind: '"tool_result"',
    output: "string",
    tool: "string",
    toolCallId: "string",
  }),
);

export const SessionViewMessageSchema = type({
  content: "string",
  createdAt: "string",
  id: "string",
  plan: SessionViewPlanEntrySchema.array(),
  role: '"assistant" | "user"',
  segments: SessionViewSegmentSchema.array(),
});

export const SessionViewFileSchema = type({
  committed: "boolean",
  createdAt: "string",
  id: "string",
  kind: '"artifact" | "attachment"',
  mimeType: NullableString,
  name: "string",
  size: "number",
});

export const SessionPermissionRequestViewSchema = type({
  driverInstanceId: "string",
  rawInput: NullableString,
  requestId: "string",
  runId: "string",
  title: "string",
  toolCallId: NullableString,
  toolKind: NullableString,
});

export const SessionReadinessIssueViewSchema = type({
  code: "string",
  "fixHref?": OptionalNullableString,
  message: "string",
  severity: '"error" | "warning"',
});

export const SessionReadinessSnapshotViewSchema = type({
  checkedAt: "string",
  issues: SessionReadinessIssueViewSchema.array(),
  ready: "boolean",
});

export const SessionCommandOptionInputSchema = type({
  hint: "string",
  kind: '"unstructured"',
});

export const SessionCommandOptionSchema = type({
  description: "string",
  "input?": type("null").or(SessionCommandOptionInputSchema),
  name: "string",
});

export const SessionModeOptionSchema = type({
  "description?": OptionalNullableString,
  id: "string",
  name: "string",
});

export const SessionConfigValueOptionSchema = type({
  "description?": OptionalNullableString,
  "group?": OptionalNullableString,
  "groupName?": OptionalNullableString,
  name: "string",
  value: "string",
});

export const SessionConfigOptionSchema = type({
  "category?": OptionalNullableString,
  currentValue: "string",
  "description?": OptionalNullableString,
  id: "string",
  name: "string",
  type: '"select"',
  values: SessionConfigValueOptionSchema.array(),
});

export const SessionUsageSummarySchema = type({
  "cachedReadTokens?": OptionalNumber,
  "cachedWriteTokens?": OptionalNumber,
  "callId?": OptionalNullableString,
  "costAmount?": OptionalNumber,
  "costCurrency?": OptionalNullableString,
  "inputTokens?": OptionalNumber,
  "model?": OptionalNullableString,
  "outputTokens?": OptionalNumber,
  "provider?": OptionalNullableString,
  "size?": OptionalNumber,
  source: '"prompt_response" | "session_update"',
  "thoughtTokens?": OptionalNumber,
  "totalTokens?": OptionalNumber,
  "usageContract?":
    '"anthropic_bucketed" | "openai_runtime_total_with_cached_breakdown" | "openai_total_with_cached_breakdown"',
  "used?": OptionalNumber,
});

export const SessionRunErrorSchema = type({
  code: "string",
  details: {
    "[string]": "string | number | boolean | null",
  },
  message: "string",
  retryable: "boolean",
});

export const SessionRunViewSchema = type({
  completedAt: NullableString,
  error: type("null").or(SessionRunErrorSchema),
  id: NullableString,
  startedAt: NullableString,
  status:
    '"idle" | "queued" | "booting" | "running" | "waiting_input" | "completed" | "failed" | "cancelled" | "expired"',
  traceId: NullableString,
});

export const SessionInfraStateSchema = type({
  lastFailureMessage: NullableString,
  lastFailureReason: NullableString,
  lastSeen: NullableString,
  reconnecting: "boolean",
});

export const SessionLiveStateSchema = type({
  commands: SessionCommandOptionSchema.array(),
  configOptions: SessionConfigOptionSchema.array(),
  currentModeId: NullableString,
  files: SessionViewFileSchema.array(),
  infra: SessionInfraStateSchema,
  lifecycle: '"IDLE" | "RUNNING" | "RESCHEDULING" | "TERMINATED"',
  messages: SessionViewMessageSchema.array(),
  permissionRequests: SessionPermissionRequestViewSchema.array(),
  plan: SessionViewPlanEntrySchema.array(),
  readiness: type("null").or(SessionReadinessSnapshotViewSchema),
  run: SessionRunViewSchema,
  sessionId: "string",
  title: NullableString,
  updatedAt: NullableString,
  usage: type("null").or(SessionUsageSummarySchema),
  viewerId: "string",
  visibleModes: SessionModeOptionSchema.array(),
});

export const JsonPatchOperationSchema = type({
  op: '"add" | "remove" | "replace"',
  path: "string",
  "value?": "unknown | undefined",
});
