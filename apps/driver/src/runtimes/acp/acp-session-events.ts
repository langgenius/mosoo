import type { DriverEventInput } from "@mosoo/driver-protocol";
import type { SessionRunId } from "@mosoo/id";

import {
  isRecord,
  readNonEmptyString,
  readNullableString,
  readNumber,
  readRecord,
  readString,
  stringifyForDisplay,
} from "./acp-types";
import type { AcpInitializeResult, JsonObject } from "./acp-types";

export function toAcpInitializeEvents(result: AcpInitializeResult): DriverEventInput[] {
  const events: DriverEventInput[] = [
    {
      kind: "runtime.capabilities.updated",
      payload: {
        capabilities: result.agentCapabilities ?? {},
        protocolVersion: result.protocolVersion,
      },
      visibility: "owner_debug",
    },
  ];

  if (result.authMethods.length > 0) {
    events.push({
      kind: "auth.methods.updated",
      payload: {
        methods: result.authMethods,
      },
      visibility: "owner_debug",
    });
  }

  return events;
}

export function toAcpPromptStartEvents(input: {
  messageId: string;
  runId: SessionRunId;
  text: string;
}): DriverEventInput[] {
  return [
    {
      actor: "user",
      kind: "message.added",
      origin: "viewer",
      payload: {
        content: [
          {
            text: input.text,
            type: "text",
          },
        ],
        messageId: input.messageId,
        role: "user",
      },
      runId: input.runId,
    },
    {
      actor: "api",
      kind: "run.dispatched",
      origin: "api",
      payload: {
        inputSummary: input.text.slice(0, 240),
        userMessageId: input.messageId,
      },
      runId: input.runId,
    },
    {
      kind: "run.started",
      payload: {
        inputItemIds: [input.messageId],
        startedAt: new Date().toISOString(),
      },
      runId: input.runId,
    },
  ];
}

export function toAcpSessionReadyEvents(input: {
  mode: "created" | "loaded" | "resumed";
  nativeSessionId: string;
  setup: JsonObject;
}): DriverEventInput[] {
  return [
    {
      kind: input.mode === "created" ? "session.created" : "session.resumed",
      payload:
        input.mode === "created"
          ? {
              mode: "acp",
              topology: "stdio",
            }
          : {
              reason: input.mode,
              resumePointer: input.nativeSessionId,
            },
    },
    {
      kind: "runtime.resume.updated",
      payload: {
        resumePointer: input.nativeSessionId,
      },
      visibility: "owner_debug",
    },
    ...toSessionModeEvents(input.setup),
    ...toSessionModelsEvents(input.setup),
    ...toSessionConfigEvents(input.setup),
    ...toSessionCapabilitiesEvents(input.setup),
  ];
}

export function toAcpAuthSessionEvent(input: {
  methodId: string;
  status: "authenticated" | "failed";
}): DriverEventInput {
  return {
    kind: "auth.session.updated",
    payload: {
      methodId: input.methodId,
      status: input.status,
    },
    visibility: "owner_debug",
  };
}

export function shouldIgnoreAcpReplayUpdate(params: unknown): boolean {
  const record = isRecord(params) ? params : {};
  const update = readRecord(record, "update");

  switch (readString(update, "sessionUpdate")) {
    case "agent_message_chunk":
    case "agent_thought_chunk":
    case "plan":
    case "tool_call":
    case "tool_call_update":
    case "user_message_chunk": {
      return true;
    }
    default: {
      return false;
    }
  }
}

export function normalizePromptUsage(raw: unknown): JsonObject | null {
  if (!isRecord(raw)) {
    return null;
  }

  const totalTokens = readNumber(raw, "totalTokens") ?? readNumber(raw, "total_tokens");
  const inputTokens = readNumber(raw, "inputTokens") ?? readNumber(raw, "input_tokens");
  const outputTokens = readNumber(raw, "outputTokens") ?? readNumber(raw, "output_tokens");

  if (totalTokens === null && inputTokens === null && outputTokens === null) {
    return null;
  }

  return {
    inputTokens,
    outputTokens,
    raw,
    source: "acp.prompt",
    totalTokens,
  };
}

export function summarizeContentBlock(content: unknown): string | null {
  if (!isRecord(content)) {
    return null;
  }

  switch (content["type"]) {
    case "text": {
      return readString(content, "text");
    }
    case "image": {
      return summarizeLabel("image", content);
    }
    case "audio": {
      return summarizeLabel("audio", content);
    }
    case "resource":
    case "resource_link": {
      return summarizeLabel("resource", content);
    }
    default: {
      return stringifyForDisplay(content);
    }
  }
}

function summarizeLabel(label: string, record: JsonObject): string {
  const title =
    readString(record, "title") ?? readString(record, "name") ?? readString(record, "uri");
  return title === null ? `[${label}]` : `[${label}: ${title}]`;
}

function normalizeAvailableCommands(raw: unknown): JsonObject[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }

  const commands = raw.flatMap((entry): JsonObject[] => {
    if (!isRecord(entry)) {
      return [];
    }

    const name = readNonEmptyString(entry, "name");

    if (name === null) {
      return [];
    }

    return [
      {
        description: readNullableString(entry, "description") ?? null,
        input: entry["input"] ?? null,
        name,
      },
    ];
  });

  return commands;
}

function normalizeConfigOptions(raw: unknown): JsonObject[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }

  return raw.filter(isRecord);
}

function normalizePlanEntries(raw: unknown): JsonObject[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.flatMap((entry, index): JsonObject[] => {
    if (!isRecord(entry)) {
      return [];
    }

    const content = readNonEmptyString(entry, "content");

    if (content === null) {
      return [];
    }

    return [
      {
        content,
        id: readNonEmptyString(entry, "id") ?? `plan-${index + 1}`,
        priority: readNullableString(entry, "priority") ?? null,
        status: readNullableString(entry, "status") ?? "pending",
      },
    ];
  });
}

export function toAvailableCommandsEvents(update: JsonObject | null): DriverEventInput[] {
  const commands = normalizeAvailableCommands(
    update?.["availableCommands"] ?? update?.["commands"],
  );

  if (commands === null) {
    return [];
  }

  return [
    {
      kind: "session.commands.updated",
      payload: {
        commands,
      },
    },
  ];
}

export function toPlanEvents(update: JsonObject | null): DriverEventInput[] {
  const entries = normalizePlanEntries(update?.["entries"]);

  if (entries.length === 0) {
    return [];
  }

  return [
    {
      kind: "plan.updated",
      payload: {
        entries,
        source: "acp",
      },
    },
  ];
}

function toSessionCapabilitiesEvents(setup: JsonObject | null): DriverEventInput[] {
  const capabilities =
    readRecord(setup, "capabilities") ?? readRecord(setup, "sessionCapabilities");

  if (capabilities === null) {
    return [];
  }

  return [
    {
      kind: "session.capabilities.updated",
      payload: {
        capabilities,
      },
      visibility: "owner_debug",
    },
  ];
}

export function toSessionConfigEvents(update: JsonObject | null): DriverEventInput[] {
  const options = normalizeConfigOptions(update?.["configOptions"] ?? update?.["options"]);

  if (options === null) {
    return [];
  }

  return [
    {
      kind: "session.config.updated",
      payload: {
        options,
      },
    },
  ];
}

export function toSessionInfoEvents(update: JsonObject | null): DriverEventInput[] {
  const title = readNullableString(update, "title");
  const goal = readNullableString(update, "goal");
  const workspace = update?.["workspace"];

  if (title === undefined && goal === undefined && workspace === undefined) {
    return [];
  }

  return [
    {
      kind: "session.info.updated",
      payload: {
        ...(goal === undefined ? {} : { goal }),
        ...(title === undefined ? {} : { title }),
        ...(workspace === undefined ? {} : { workspace }),
      },
    },
  ];
}

export function toSessionModeEvents(update: JsonObject | null): DriverEventInput[] {
  const currentMode =
    readNullableString(update, "currentModeId") ??
    readNullableString(update, "currentMode") ??
    undefined;
  const availableModes =
    update?.["availableModes"] ?? update?.["visibleModes"] ?? update?.["modes"];

  if (currentMode === undefined && availableModes === undefined) {
    return [];
  }

  return [
    {
      kind: "session.mode.updated",
      payload: {
        ...(availableModes === undefined ? {} : { availableModes }),
        ...(currentMode === undefined ? {} : { currentMode }),
      },
    },
  ];
}

function toSessionModelsEvents(setup: JsonObject | null): DriverEventInput[] {
  const currentModel = readNullableString(setup, "currentModel") ?? undefined;
  const availableModels = setup?.["availableModels"] ?? setup?.["models"];
  const providers = setup?.["providers"];

  if (currentModel === undefined && availableModels === undefined && providers === undefined) {
    return [];
  }

  return [
    {
      kind: "session.models.updated",
      payload: {
        ...(availableModels === undefined ? {} : { availableModels }),
        ...(currentModel === undefined ? {} : { currentModel }),
        ...(providers === undefined ? {} : { providers }),
      },
    },
  ];
}

export function toUsageUpdateEvents(update: JsonObject | null): DriverEventInput[] {
  const used = readNumber(update, "used");
  const size = readNumber(update, "size");
  const cost = update?.["cost"];

  if (used === null && size === null && cost === undefined) {
    return [];
  }

  return [
    {
      kind: "usage.updated",
      payload: {
        cost,
        size,
        source: "acp.session",
        used,
      },
    },
  ];
}
