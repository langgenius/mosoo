import { type } from "arktype";

export const SessionViewPlanEntrySchema = type({
  content: "string",
  priority: '"high" | "medium" | "low"',
  status: '"pending" | "in_progress" | "completed"',
});

export const SessionViewFileSchema = type({
  committed: "boolean",
  createdAt: "string",
  id: "string",
  kind: '"artifact" | "attachment"',
  mimeType: "string | null",
  name: "string",
  size: "number",
});

export const SessionPermissionRequestViewSchema = type({
  driverInstanceId: "string",
  rawInput: "string | null",
  requestId: "string",
  runId: "string",
  title: "string",
  toolCallId: "string | null",
  toolKind: "string | null",
});

const SessionCommandOptionInputSchema = type({
  hint: "string",
  kind: '"unstructured"',
});

export const SessionCommandOptionSchema = type({
  description: "string",
  "input?": type("null").or(SessionCommandOptionInputSchema),
  name: "string",
});

export const SessionModeOptionSchema = type({
  "description?": "string | null",
  id: "string",
  name: "string",
});

const SessionConfigValueOptionSchema = type({
  "description?": "string | null",
  "group?": "string | null",
  "groupName?": "string | null",
  name: "string",
  value: "string",
});

export const SessionConfigOptionSchema = type({
  "category?": "string | null",
  currentValue: "string",
  "description?": "string | null",
  id: "string",
  name: "string",
  type: '"select"',
  values: SessionConfigValueOptionSchema.array(),
});

// Driver-reported usage feeds the cost ledger; number.safe rejects Infinity and
// magnitudes whose arithmetic overflows before the NOT NULL usage columns.
export const SessionUsageSummarySchema = type({
  "cachedReadTokens?": "number.safe | null",
  "cachedWriteTokens?": "number.safe | null",
  "callId?": "string | null",
  "costAmount?": "number.safe | null",
  "costCurrency?": "string | null",
  "inputTokens?": "number.safe | null",
  "model?": "string | null",
  "outputTokens?": "number.safe | null",
  "provider?": "string | null",
  "size?": "number.safe | null",
  source: '"prompt_response" | "session_update"',
  "thoughtTokens?": "number.safe | null",
  "totalTokens?": "number.safe | null",
  "usageContract?":
    '"anthropic_bucketed" | "openai_runtime_total_with_cached_breakdown" | "openai_total_with_cached_breakdown"',
  "used?": "number.safe | null",
});
