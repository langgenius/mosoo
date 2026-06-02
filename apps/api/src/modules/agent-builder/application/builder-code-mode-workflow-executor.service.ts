import type {
  AgentBuilderToolExecutionRecord,
  AgentBuilderToolPayload,
} from "@mosoo/contracts/agent-builder";

import type { AgentBuilderToolRuntime } from "./agent-builder-tool-runtime.service";
import type {
  BuilderWorkflowExecutionInput,
  BuilderWorkflowExecutionResult,
  BuilderWorkflowExecutor,
} from "./builder-workflow-executor.service";
import { listAgentBuilderAssemblyToolIds } from "./builder-workflow-tool-descriptor.service";

interface CodeModeExecuteResult {
  readonly error?: string;
  readonly logs?: string[];
  readonly result: unknown;
}

interface CodeModeResolvedProvider {
  readonly fns: Record<string, (...args: unknown[]) => Promise<unknown>>;
  readonly name: string;
}

interface CodeModeExecutor {
  execute(code: string, providers: CodeModeResolvedProvider[]): Promise<CodeModeExecuteResult>;
}

interface DynamicWorkerExecutorOptions {
  readonly globalOutbound: Fetcher | null;
  readonly loader: WorkerLoader;
  readonly timeout: number;
}

interface DynamicWorkerExecutorConstructor {
  new (options: DynamicWorkerExecutorOptions): CodeModeExecutor;
}

interface CloudflareCodeModeModule {
  readonly DynamicWorkerExecutor: DynamicWorkerExecutorConstructor;
}

export type CloudflareCodeModeModuleLoader = () => Promise<CloudflareCodeModeModule>;

const MAX_LOG_ENTRIES = 200;
const MAX_LOG_LENGTH = 2_000;

async function loadCloudflareCodeModeModule(): Promise<CloudflareCodeModeModule> {
  const moduleValue = (await import("@cloudflare/codemode")) as unknown;

  if (
    moduleValue === null ||
    typeof moduleValue !== "object" ||
    !("DynamicWorkerExecutor" in moduleValue)
  ) {
    throw new Error("Cloudflare Code Mode module does not export DynamicWorkerExecutor.");
  }

  return {
    DynamicWorkerExecutor: moduleValue.DynamicWorkerExecutor as DynamicWorkerExecutorConstructor,
  };
}

function formatWorkflowError(error: unknown): string {
  return error instanceof Error ? error.message : "Agent Builder Code Mode workflow failed.";
}

function normalizeLogs(logs: readonly string[] | undefined): string[] {
  return (logs ?? []).slice(0, MAX_LOG_ENTRIES).map((entry) => entry.slice(0, MAX_LOG_LENGTH));
}

function createCodeModeToolProvider(input: {
  tools: AgentBuilderToolRuntime;
  trace: AgentBuilderToolExecutionRecord[];
}): CodeModeResolvedProvider {
  const fns: Record<string, (...args: unknown[]) => Promise<unknown>> = {};

  for (const toolId of listAgentBuilderAssemblyToolIds()) {
    fns[toolId] = async (args: unknown) => {
      const record = await input.tools.execute({
        input: parseToolInput(args),
        toolId,
      });

      input.trace.push(record);

      if (record.status !== "completed" || record.output === null) {
        throw new Error(record.errorMessage ?? `Agent Builder tool failed: ${toolId}.`);
      }

      return record.output;
    };
  }

  return {
    fns,
    name: "builder",
  };
}

function parseToolInput(input: unknown): AgentBuilderToolPayload {
  if (input === undefined || input === null) {
    return {};
  }

  if (typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Agent Builder Code Mode tool input must be an object.");
  }

  return input as AgentBuilderToolPayload;
}

export function createCodeModeBuilderWorkflowExecutor(input: {
  readonly loader: WorkerLoader;
  readonly loadCodeModeModule?: CloudflareCodeModeModuleLoader;
}): BuilderWorkflowExecutor {
  const loadCodeModeModule = input.loadCodeModeModule ?? loadCloudflareCodeModeModule;

  return {
    async execute(
      workflowInput: BuilderWorkflowExecutionInput,
    ): Promise<BuilderWorkflowExecutionResult> {
      const trace: AgentBuilderToolExecutionRecord[] = [];

      try {
        const moduleValue = await loadCodeModeModule();
        const executor = new moduleValue.DynamicWorkerExecutor({
          globalOutbound: null,
          loader: input.loader,
          timeout: workflowInput.timeoutMs,
        });
        const result = await executor.execute(workflowInput.code, [
          createCodeModeToolProvider({
            tools: workflowInput.tools,
            trace,
          }),
        ]);

        return {
          errorMessage: result.error ?? null,
          logs: normalizeLogs(result.logs),
          result: result.result,
          trace,
        };
      } catch (error) {
        return {
          errorMessage: formatWorkflowError(error),
          logs: [],
          result: null,
          trace,
        };
      }
    },
  };
}
