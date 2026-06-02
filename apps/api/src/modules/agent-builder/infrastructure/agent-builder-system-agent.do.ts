import type { AgentBuilderPlannerRunId, AgentId } from "@mosoo/id";
import type { AgentBuilderThreadId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import type { AuthenticatedSystemAgentChatInput } from "../../system-agent/infrastructure/authenticated-system-agent.do";
import { AuthenticatedSystemAgent } from "../../system-agent/infrastructure/authenticated-system-agent.do";
import type { AgentBuilderProgressReporter } from "../application/agent-builder-progress.service";
import {
  parseAgentBuilderSystemAgentChatBody,
  readLatestUserTextFromChatMessages,
} from "../application/agent-builder-system-agent-chat-request.service";
import { createAgentBuilderSystemAgentChatResponse } from "../application/agent-builder-system-agent-chat.service";
import {
  assertAgentBuilderSystemAgentInstanceIdentity,
  parseAgentBuilderSystemAgentInstanceName,
} from "../application/agent-builder-system-agent-instance";
import {
  approveAgentBuilderSystemAgentStarterPack,
  submitAgentBuilderSystemAgentMessage,
} from "../application/agent-builder-system-agent-rpc.service";
import type { AgentBuilderSystemAgentRpcResult } from "../application/agent-builder-system-agent-rpc.service";
import { createAgentBuilderSystemAgentSubmitRuntime } from "../application/agent-builder-system-agent-runtime.service";
import type { AgentBuilderSystemAgentState } from "../application/agent-builder-system-agent-state.service";
import { INITIAL_AGENT_BUILDER_SYSTEM_AGENT_STATE } from "../application/agent-builder-system-agent-state.service";

export class AgentBuilderSystemAgent extends AuthenticatedSystemAgent<AgentBuilderSystemAgentState> {
  override initialState = INITIAL_AGENT_BUILDER_SYSTEM_AGENT_STATE;
  protected override readonly systemAgentName = "Agent Builder System Agent";

  override validateStateChange(nextState: AgentBuilderSystemAgentState): void {
    if (nextState.openApprovalCount < 0) {
      throw new Error("Agent Builder openApprovalCount cannot be negative.");
    }
  }

  protected override async handleAuthenticatedChatMessage(
    input: AuthenticatedSystemAgentChatInput,
  ): Promise<Response> {
    const body = parseAgentBuilderSystemAgentChatBody(input.options.body);
    const instance = parseAgentBuilderSystemAgentInstanceName(this.name);
    const inputText = readLatestUserTextFromChatMessages(this.messages);

    assertAgentBuilderSystemAgentInstanceIdentity({
      bodyAgentId: body.agentId,
      bodyThreadId: body.threadId,
      instance,
    });

    return createAgentBuilderSystemAgentChatResponse({
      run: (progress) =>
        this.submitBuilderMessage({
          ...body,
          inputText,
          progress,
          viewer: input.viewer,
        }),
    });
  }

  async submitBuilderMessage(input: {
    readonly agentId: AgentId;
    readonly draftRevision: string;
    readonly draftYaml: string;
    readonly inputText: string;
    readonly progress?: AgentBuilderProgressReporter;
    readonly threadId: AgentBuilderThreadId;
    readonly viewer: AuthenticatedViewer;
  }): Promise<AgentBuilderSystemAgentRpcResult> {
    const result = await submitAgentBuilderSystemAgentMessage(this.env, input.viewer, {
      agentId: input.agentId,
      draftRevision: input.draftRevision,
      draftYaml: input.draftYaml,
      inputText: input.inputText,
      ...(input.progress === undefined ? {} : { progress: input.progress }),
      runtime: createAgentBuilderSystemAgentSubmitRuntime({
        bindings: this.env,
        viewer: input.viewer,
      }),
      threadId: input.threadId,
    });

    return this.syncStateFromResult(result);
  }

  async approveStarterPack(input: {
    readonly agentId: AgentId;
    readonly mode: "batch" | "single";
    readonly nodeKey?: string | null;
    readonly plannerRunId: AgentBuilderPlannerRunId;
    readonly viewer: AuthenticatedViewer;
  }): Promise<AgentBuilderSystemAgentRpcResult> {
    const result = await approveAgentBuilderSystemAgentStarterPack(this.env, input.viewer, {
      agentId: input.agentId,
      mode: input.mode,
      ...(input.nodeKey === undefined ? {} : { nodeKey: input.nodeKey }),
      plannerRunId: input.plannerRunId,
    });

    return this.syncStateFromResult(result);
  }
}
