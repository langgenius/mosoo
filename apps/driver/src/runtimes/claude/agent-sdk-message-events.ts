import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { DriverEventInput } from "@mosoo/driver-protocol";

import { isRecord, readNumber, readString } from "./agent-sdk-json";
import type { JsonObject } from "./agent-sdk-json";

export function toClaudeFilesPersistedEvents(
  message: Extract<SDKMessage, { type: "system"; subtype: "files_persisted" }>,
): DriverEventInput[] {
  const events: DriverEventInput[] = message.files.map((file) => ({
    actor: "tool",
    kind: "file.change.updated",
    origin: "file",
    payload: {
      changes: [
        {
          change: "upsert",
          path: file.filename,
        },
      ],
      status: "completed",
    },
  }));

  if (message.failed.length > 0) {
    events.push({
      kind: "diagnostic.reported",
      payload: {
        failed: message.failed,
        message: "Claude file persistence failed.",
        severity: "warn",
      },
      visibility: "owner_debug",
    });
  }

  return events;
}

export function toClaudeDiagnosticEvent(message: SDKMessage): JsonObject {
  const record = isRecord(message) ? message : {};

  return {
    kind: "claude.diagnostic",
    sessionIdPresent: Boolean(readString(record, "session_id")),
    subtype: readString(record, "subtype"),
    type: readString(record, "type"),
  };
}

export function toClaudeUsageUpdatedEvents(
  usage: JsonObject | null,
  costAmount: number | null,
): DriverEventInput[] {
  if (!usage && costAmount === null) {
    return [];
  }

  const inputTokens = readNumber(usage, "input_tokens");
  const outputTokens = readNumber(usage, "output_tokens");
  const cacheReadTokens = readNumber(usage, "cache_read_input_tokens");
  const cacheCreationTokens = readNumber(usage, "cache_creation_input_tokens");
  const totalTokens =
    inputTokens === null && outputTokens === null ? null : (inputTokens ?? 0) + (outputTokens ?? 0);

  return [
    {
      kind: "usage.updated",
      payload: {
        cachedReadTokens: cacheReadTokens,
        cachedWriteTokens: cacheCreationTokens,
        costAmount,
        costCurrency: costAmount === null ? null : "USD",
        inputTokens,
        outputTokens,
        size: null,
        source: "session_update",
        thoughtTokens: null,
        totalTokens,
        usageContract: "anthropic_bucketed",
        used: null,
      },
    },
  ];
}
