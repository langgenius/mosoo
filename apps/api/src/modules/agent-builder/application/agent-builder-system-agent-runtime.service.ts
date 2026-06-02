import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { createAgentBuilderPlannerToolRuntime } from "./agent-builder-planner-tool-registry.service";
import type { AgentBuilderToolRuntime } from "./agent-builder-tool-runtime.service";
import { createCodeModeBuilderWorkflowExecutor } from "./builder-code-mode-workflow-executor.service";
import type {
  AgentBuilderAssemblyToolRuntimeFactory,
  AgentBuilderAssemblyWorkflowCodeFactory,
} from "./builder-conversation-turn.service";
import { generateAgentBuilderAssemblyWorkflowCode } from "./builder-workflow-code-generator.service";
import type { BuilderWorkflowExecutor } from "./builder-workflow-executor.service";

const DEFAULT_AGENT_BUILDER_SYSTEM_AGENT_WORKFLOW_CODE = [
  "// Code Mode executor is not configured yet.",
  "throw new Error('Agent Builder Code Mode executor is not configured.');",
].join("\n");

const AGENT_BUILDER_SYSTEM_AGENT_WORKFLOW_TIMEOUT_MS = 120_000;

export interface AgentBuilderSystemAgentSubmitMessageRuntime {
  readonly code: AgentBuilderAssemblyWorkflowCodeFactory | string;
  readonly executor: BuilderWorkflowExecutor;
  readonly timeoutMs: number;
  readonly tools: AgentBuilderAssemblyToolRuntimeFactory | AgentBuilderToolRuntime;
}

function createUnavailableWorkflowExecutor(): BuilderWorkflowExecutor {
  return {
    async execute() {
      return {
        errorMessage: "Agent Builder Code Mode executor is not configured.",
        logs: [],
        result: null,
        trace: [],
      };
    },
  };
}

export function createAgentBuilderSystemAgentSubmitRuntime(input: {
  readonly bindings: ApiBindings;
  readonly viewer: AuthenticatedViewer;
}): AgentBuilderSystemAgentSubmitMessageRuntime {
  const code =
    input.bindings.AGENT_BUILDER_CODE_WORKER_LOADER === undefined
      ? DEFAULT_AGENT_BUILDER_SYSTEM_AGENT_WORKFLOW_CODE
      : (context: Parameters<AgentBuilderAssemblyWorkflowCodeFactory>[0]) =>
          generateAgentBuilderAssemblyWorkflowCode({
            bindings: input.bindings,
            context,
            viewer: input.viewer,
          });
  const executor =
    input.bindings.AGENT_BUILDER_CODE_WORKER_LOADER === undefined
      ? createUnavailableWorkflowExecutor()
      : createCodeModeBuilderWorkflowExecutor({
          loader: input.bindings.AGENT_BUILDER_CODE_WORKER_LOADER,
        });

  return {
    code,
    executor,
    timeoutMs: AGENT_BUILDER_SYSTEM_AGENT_WORKFLOW_TIMEOUT_MS,
    tools: (context) =>
      createAgentBuilderPlannerToolRuntime({
        actorAccountId: input.viewer.id,
        bindings: input.bindings,
        context,
        viewer: input.viewer,
      }),
  };
}
