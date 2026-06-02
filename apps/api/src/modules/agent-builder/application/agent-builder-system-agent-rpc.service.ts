import type { AgentBuilderPlannerRunId, AgentBuilderThreadId, AgentId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import type { AgentBuilderProgressReporter } from "./agent-builder-progress.service";
import type { AgentBuilderSystemAgentSubmitMessageRuntime } from "./agent-builder-system-agent-runtime.service";
import type { AgentBuilderSystemAgentState } from "./agent-builder-system-agent-state.service";
import {
  createAgentBuilderSystemAgentStateFromMessages,
  readOpenAgentBuilderApprovalCountForPlannerRun,
} from "./agent-builder-system-agent-state.service";
import { createCompletedAgentBuilderSystemAgentTerminalResult } from "./agent-builder-system-agent-terminal.service";
import type { AgentBuilderSystemAgentTerminalResult } from "./agent-builder-system-agent-terminal.service";
import type { AgentBuilderMessageModel } from "./agent-builder-thread.service";
import { ensureAgentBuilderThreadAddress } from "./agent-builder-thread.service";
import { appendAgentBuilderAssemblyTurnResult } from "./builder-conversation-turn.service";
import { approveAgentBuilderStarterPack } from "./builder-starter-pack-approval-ledger.service";

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

  const turn = await appendAgentBuilderAssemblyTurnResult(bindings, viewer, {
    agentId: input.agentId,
    code: input.runtime.code,
    draftRevision: input.draftRevision,
    draftYaml: input.draftYaml,
    executor: input.runtime.executor,
    inputText: input.inputText,
    ...(input.progress === undefined ? {} : { progress: input.progress }),
    timeoutMs: input.runtime.timeoutMs,
    tools: input.runtime.tools,
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

export async function approveAgentBuilderSystemAgentStarterPack(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: {
    readonly agentId: AgentId;
    readonly mode: "batch" | "single";
    readonly nodeKey?: string | null;
    readonly plannerRunId: AgentBuilderPlannerRunId;
  },
): Promise<AgentBuilderSystemAgentRpcResult> {
  const messages = await approveAgentBuilderStarterPack(bindings, viewer, input);

  return {
    messages,
    state: {
      draftId: input.agentId,
      lastPlannerRunId: input.plannerRunId,
      openApprovalCount: await readOpenAgentBuilderApprovalCountForPlannerRun(
        bindings.DB,
        input.plannerRunId,
      ),
    },
    terminal: createCompletedAgentBuilderSystemAgentTerminalResult(),
  };
}
