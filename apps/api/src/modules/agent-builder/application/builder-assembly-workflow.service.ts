import type { AgentBuilderStarterPackResult } from "@mosoo/contracts/agent-builder";
import type { AgentBuilderPlannerRunId } from "@mosoo/id";

import type { AgentBuilderToolRuntime } from "./agent-builder-tool-runtime.service";
import { admitAgentBuilderStarterPackWorkflowResult } from "./builder-assembly-workflow-admission.service";
import { repairAgentBuilderAssemblyWorkflowResult } from "./builder-assembly-workflow-repair.service";
import type {
  BuilderWorkflowExecutionResult,
  BuilderWorkflowExecutor,
} from "./builder-workflow-executor.service";

export type AgentBuilderAssemblyWorkflowRunResult =
  | {
      errors: string[];
      execution: BuilderWorkflowExecutionResult;
      status: "blocked";
    }
  | {
      errors: string[];
      execution: BuilderWorkflowExecutionResult;
      status: "failed";
    }
  | {
      execution: BuilderWorkflowExecutionResult;
      result: AgentBuilderStarterPackResult;
      status: "completed";
    };

export interface RunAgentBuilderAssemblyWorkflowInput {
  readonly code: string;
  readonly executor: BuilderWorkflowExecutor;
  readonly plannerRunId: AgentBuilderPlannerRunId;
  readonly timeoutMs: number;
  readonly tools: AgentBuilderToolRuntime;
}

export async function runAgentBuilderAssemblyWorkflow(
  input: RunAgentBuilderAssemblyWorkflowInput,
): Promise<AgentBuilderAssemblyWorkflowRunResult> {
  const execution = await input.executor.execute({
    code: input.code,
    timeoutMs: input.timeoutMs,
    tools: input.tools,
  });

  const repairedWorkflowResult = await repairAgentBuilderAssemblyWorkflowResult({
    plannerRunId: input.plannerRunId,
    result: execution.result,
    tools: input.tools,
    trace: execution.trace,
  });
  const admission = admitAgentBuilderStarterPackWorkflowResult(repairedWorkflowResult.result, {
    plannerRunId: input.plannerRunId,
    trace: repairedWorkflowResult.trace,
  });

  if (execution.errorMessage !== null && (!admission.valid || admission.result === null)) {
    return {
      errors: [execution.errorMessage],
      execution: {
        ...execution,
        result: repairedWorkflowResult.result,
        trace: repairedWorkflowResult.trace,
      },
      status: "failed",
    };
  }

  const repairedExecution: BuilderWorkflowExecutionResult = {
    ...execution,
    errorMessage: null,
    result: repairedWorkflowResult.result,
    trace: repairedWorkflowResult.trace,
  };

  if (!admission.valid || admission.result === null) {
    return {
      errors: admission.errors,
      execution: repairedExecution,
      status: "blocked",
    };
  }

  return {
    execution: repairedExecution,
    result: admission.result,
    status: "completed",
  };
}
