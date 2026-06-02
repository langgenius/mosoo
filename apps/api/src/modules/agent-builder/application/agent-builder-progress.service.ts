import type { AgentBuilderToolId } from "@mosoo/contracts/agent-builder";

import type { AgentBuilderToolRuntime } from "./agent-builder-tool-runtime.service";

export interface AgentBuilderProgressEvent {
  readonly message: string;
  readonly stage: string;
}

export type AgentBuilderProgressReporter = (event: AgentBuilderProgressEvent) => void;

const TOOL_PROGRESS_MESSAGES: Partial<Record<string, string>> = {
  ask_user: "正在准备需要你确认的选项",
  dry_run_draft_patch: "正在校验 Draft 修改",
  get_draft_snapshot: "正在读取当前 Draft",
  prepare_bind_environment_patch: "正在准备 Environment 绑定",
  prepare_bind_mcp_patch: "正在准备 MCP 绑定",
  prepare_bind_skill_patch: "正在准备 Skill 绑定",
  prepare_bind_space_patch: "正在准备 Space 绑定",
  prepare_draft_patch: "正在准备 Draft 修改",
  resolve_asset_reference: "正在匹配已有资产",
  search_assets: "正在搜索可用资产",
} satisfies Partial<Record<AgentBuilderToolId, string>>;

function readToolProgressMessage(toolId: string): string {
  return TOOL_PROGRESS_MESSAGES[toolId as AgentBuilderToolId] ?? `正在调用 ${toolId}`;
}

export function reportAgentBuilderProgress(
  reporter: AgentBuilderProgressReporter | undefined,
  event: AgentBuilderProgressEvent,
): void {
  reporter?.(event);
}

export function withAgentBuilderProgressReporting(input: {
  readonly progress?: AgentBuilderProgressReporter;
  readonly tools: AgentBuilderToolRuntime;
}): AgentBuilderToolRuntime {
  if (input.progress === undefined) {
    return input.tools;
  }

  return {
    async execute(toolInput) {
      reportAgentBuilderProgress(input.progress, {
        message: readToolProgressMessage(toolInput.toolId),
        stage: `tool:${toolInput.toolId}`,
      });

      return await input.tools.execute(toolInput);
    },
  };
}
