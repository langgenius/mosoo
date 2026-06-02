import type {
  AgentBuilderToolExecutionRecord,
  AgentBuilderToolId,
  AgentBuilderToolPayload,
} from "@mosoo/contracts/agent-builder";
import { isAgentBuilderToolId } from "@mosoo/contracts/agent-builder";

export interface AgentBuilderToolDefinition {
  execute: (
    input: AgentBuilderToolPayload,
  ) => AgentBuilderToolPayload | Promise<AgentBuilderToolPayload>;
  summarizeInput?: (input: AgentBuilderToolPayload) => string;
  summarizeOutput?: (output: AgentBuilderToolPayload) => string;
  toolId: AgentBuilderToolId;
}

export interface AgentBuilderToolRuntime {
  execute(input: {
    input: AgentBuilderToolPayload;
    toolId: string;
  }): Promise<AgentBuilderToolExecutionRecord>;
}

export interface AgentBuilderToolRuntimeOptions {
  now?: () => string;
  tools: AgentBuilderToolDefinition[];
}

const SUMMARY_FIELD_LIMIT = 20;

function createIsoTimestamp(): string {
  return new Date().toISOString();
}

function describePayloadValue(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }

  if (typeof value === "string") {
    return `string(${value.length})`;
  }

  if (typeof value === "number") {
    return "number";
  }

  if (typeof value === "boolean") {
    return "boolean";
  }

  if (typeof value === "undefined") {
    return "undefined";
  }

  if (typeof value === "object") {
    return "object";
  }

  return typeof value;
}

export function summarizeAgentBuilderToolPayload(payload: AgentBuilderToolPayload): string {
  const entries = Object.entries(payload)
    .toSorted(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .slice(0, SUMMARY_FIELD_LIMIT)
    .map(([key, value]) => `${key}:${describePayloadValue(value)}`);

  if (entries.length === 0) {
    return "{}";
  }

  return `{${entries.join(",")}}`;
}

function createToolRegistry(
  tools: AgentBuilderToolDefinition[],
): Map<AgentBuilderToolId, AgentBuilderToolDefinition> {
  const registry = new Map<AgentBuilderToolId, AgentBuilderToolDefinition>();

  for (const tool of tools) {
    registry.set(tool.toolId, tool);
  }

  return registry;
}

function createFailedToolRecord(input: {
  completedAt: string;
  errorMessage: string;
  input: AgentBuilderToolPayload;
  redactedInputSummary: string;
  requestedToolId: string;
  startedAt: string;
  toolId: AgentBuilderToolId | null;
}): AgentBuilderToolExecutionRecord {
  return {
    completedAt: input.completedAt,
    errorMessage: input.errorMessage,
    input: input.input,
    output: null,
    redactedInputSummary: input.redactedInputSummary,
    redactedOutputSummary: null,
    requestedToolId: input.requestedToolId,
    startedAt: input.startedAt,
    status: "failed",
    toolId: input.toolId,
  };
}

export function createAgentBuilderToolRuntime(
  options: AgentBuilderToolRuntimeOptions,
): AgentBuilderToolRuntime {
  const registry = createToolRegistry(options.tools);
  const now = options.now ?? createIsoTimestamp;

  return {
    async execute(input) {
      const startedAt = now();
      const redactedInputSummary = summarizeAgentBuilderToolPayload(input.input);

      if (!isAgentBuilderToolId(input.toolId)) {
        return createFailedToolRecord({
          completedAt: now(),
          errorMessage: `Unknown Agent Builder tool: ${input.toolId}.`,
          input: input.input,
          redactedInputSummary,
          requestedToolId: input.toolId,
          startedAt,
          toolId: null,
        });
      }

      const tool = registry.get(input.toolId);

      if (tool === undefined) {
        return createFailedToolRecord({
          completedAt: now(),
          errorMessage: `Agent Builder tool is not registered: ${input.toolId}.`,
          input: input.input,
          redactedInputSummary,
          requestedToolId: input.toolId,
          startedAt,
          toolId: input.toolId,
        });
      }

      try {
        const output = await tool.execute(input.input);

        return {
          completedAt: now(),
          errorMessage: null,
          input: input.input,
          output,
          redactedInputSummary: tool.summarizeInput?.(input.input) ?? redactedInputSummary,
          redactedOutputSummary:
            tool.summarizeOutput?.(output) ?? summarizeAgentBuilderToolPayload(output),
          requestedToolId: input.toolId,
          startedAt,
          status: "completed",
          toolId: input.toolId,
        };
      } catch (error) {
        return createFailedToolRecord({
          completedAt: now(),
          errorMessage:
            error instanceof Error ? error.message : "Agent Builder tool execution failed.",
          input: input.input,
          redactedInputSummary: tool.summarizeInput?.(input.input) ?? redactedInputSummary,
          requestedToolId: input.toolId,
          startedAt,
          toolId: input.toolId,
        });
      }
    },
  };
}
