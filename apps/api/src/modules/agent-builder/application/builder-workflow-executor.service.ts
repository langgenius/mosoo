import type {
  AgentBuilderToolExecutionRecord,
  AgentBuilderToolId,
  AgentBuilderToolPayload,
} from "@mosoo/contracts/agent-builder";

import type { AgentBuilderToolRuntime } from "./agent-builder-tool-runtime.service";

export interface BuilderWorkflowExecutionInput {
  readonly code: string;
  readonly timeoutMs: number;
  readonly tools: AgentBuilderToolRuntime;
}

export interface BuilderWorkflowExecutionResult {
  readonly errorMessage: string | null;
  readonly logs: string[];
  readonly result: unknown;
  readonly trace: AgentBuilderToolExecutionRecord[];
}

export interface BuilderWorkflowExecutor {
  execute(input: BuilderWorkflowExecutionInput): Promise<BuilderWorkflowExecutionResult>;
}

export interface DeterministicBuilderWorkflowContext {
  callTool(input: {
    input?: AgentBuilderToolPayload;
    toolId: AgentBuilderToolId;
  }): Promise<AgentBuilderToolPayload>;
  log(message: string): void;
}

export type DeterministicBuilderWorkflow = (
  context: DeterministicBuilderWorkflowContext,
  input: BuilderWorkflowExecutionInput,
) => Promise<unknown> | unknown;

const MAX_LOG_ENTRIES = 200;
const MAX_LOG_LENGTH = 2_000;

function formatWorkflowError(error: unknown): string {
  return error instanceof Error ? error.message : "Agent Builder workflow execution failed.";
}

function normalizeTimeoutMs(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Builder workflow timeoutMs must be a positive finite number.");
  }

  return timeoutMs;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Builder workflow timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function createLogSink(): {
  log(message: string): void;
  logs(): string[];
} {
  const logs: string[] = [];

  return {
    log(message) {
      if (logs.length >= MAX_LOG_ENTRIES) {
        return;
      }

      logs.push(message.slice(0, MAX_LOG_LENGTH));
    },
    logs() {
      return [...logs];
    },
  };
}

export function createDeterministicBuilderWorkflowExecutor(
  workflow: DeterministicBuilderWorkflow,
): BuilderWorkflowExecutor {
  return {
    async execute(input) {
      const trace: AgentBuilderToolExecutionRecord[] = [];
      const logSink = createLogSink();

      try {
        const timeoutMs = normalizeTimeoutMs(input.timeoutMs);
        const context: DeterministicBuilderWorkflowContext = {
          async callTool(toolInput) {
            const record = await input.tools.execute({
              input: toolInput.input ?? {},
              toolId: toolInput.toolId,
            });

            trace.push(record);

            if (record.status !== "completed" || record.output === null) {
              throw new Error(
                record.errorMessage ?? `Agent Builder tool failed: ${toolInput.toolId}.`,
              );
            }

            return record.output;
          },
          log(message) {
            logSink.log(message);
          },
        };

        const result = await withTimeout(Promise.resolve(workflow(context, input)), timeoutMs);

        return {
          errorMessage: null,
          logs: logSink.logs(),
          result,
          trace,
        };
      } catch (error) {
        return {
          errorMessage: formatWorkflowError(error),
          logs: logSink.logs(),
          result: null,
          trace,
        };
      }
    },
  };
}
