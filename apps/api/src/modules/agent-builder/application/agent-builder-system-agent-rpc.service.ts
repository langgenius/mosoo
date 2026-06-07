import type { AgentBuilderThreadId, AgentId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { appendAgentBuilderPlannerTurnResult } from "./agent-builder-planner-turn.service";
import type { AgentBuilderProgressReporter } from "./agent-builder-progress.service";
import type { AgentBuilderSystemAgentSubmitMessageRuntime } from "./agent-builder-system-agent-runtime.service";
import type { AgentBuilderSystemAgentState } from "./agent-builder-system-agent-state.service";
import { createAgentBuilderSystemAgentStateFromMessages } from "./agent-builder-system-agent-state.service";
import type { AgentBuilderSystemAgentTerminalResult } from "./agent-builder-system-agent-terminal.service";
import type { AgentBuilderMessageModel } from "./agent-builder-thread.service";
import { ensureAgentBuilderThreadAddress } from "./agent-builder-thread.service";

export type { AgentBuilderSystemAgentState } from "./agent-builder-system-agent-state.service";

export interface AgentBuilderSystemAgentRpcResult {
  readonly messages: AgentBuilderMessageModel[];
  readonly state: AgentBuilderSystemAgentState;
  readonly terminal: AgentBuilderSystemAgentTerminalResult;
}

export async function submitAgentBuilderSystemAgentMessage(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: {
    readonly agentId: AgentId;
    readonly draftRevision: string;
    readonly draftYaml: string;
    readonly inputText: string;
    readonly progress?: AgentBuilderProgressReporter;
    readonly runtime: AgentBuilderSystemAgentSubmitMessageRuntime;
    readonly threadId: AgentBuilderThreadId;
  },
): Promise<AgentBuilderSystemAgentRpcResult> {
  await ensureAgentBuilderThreadAddress(bindings.DB, viewer, {
    agentId: input.agentId,
    threadId: input.threadId,
  });

  const turn = await appendAgentBuilderPlannerTurnResult(bindings, viewer, {
    agentId: input.agentId,
    draftRevision: input.draftRevision,
    draftYaml: input.draftYaml,
    inputText: input.inputText,
    planner: input.runtime.planner,
    ...(input.progress === undefined ? {} : { progress: input.progress }),
  });

  return {
    messages: turn.messages,
    state: createAgentBuilderSystemAgentStateFromMessages({
      agentId: input.agentId,
      messages: turn.messages,
    }),
    terminal: turn.terminal,
  };
}
