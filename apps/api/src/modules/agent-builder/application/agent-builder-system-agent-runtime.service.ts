import type { AgentBuilderPlannerContext } from "@mosoo/contracts/agent-builder";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { isAgentBuilderOptionalComponentStructuredReplyNodeKey } from "./agent-builder-component-planner-policy.service";
import { isAgentBuilderEnvironmentStructuredReplyNodeKey } from "./agent-builder-environment-planner-policy.service";
import { createDefaultAgentBuilderLightweightPlanner } from "./agent-builder-lightweight-planner-policy.service";
import { createAgentBuilderLlmPlanner } from "./agent-builder-llm-planner.service";
import type { AgentBuilderLightweightPlanner } from "./agent-builder-planner-turn.service";
import { parseAgentBuilderStructuredReply } from "./agent-builder-structured-input";

export interface AgentBuilderSystemAgentSubmitMessageRuntime {
  readonly planner: AgentBuilderLightweightPlanner;
}

export type AgentBuilderSystemAgentPlannerRoute = "deterministic" | "llm";

function isLatestPendingQuestionReply(
  context: AgentBuilderPlannerContext,
  nodeKey: string,
): boolean {
  const latestNode = context.historicalOpenNodes[0] ?? null;

  return (
    latestNode !== null &&
    latestNode.kind === "question" &&
    latestNode.nodeKey === nodeKey &&
    latestNode.status === "pending"
  );
}

export function selectAgentBuilderSystemAgentPlannerRoute(
  context: AgentBuilderPlannerContext,
): AgentBuilderSystemAgentPlannerRoute {
  if (context.turn.inputKind !== "question_answer") {
    return "llm";
  }

  const reply = parseAgentBuilderStructuredReply(context.turn.inputText);

  if (reply === null) {
    return "llm";
  }

  if (
    isAgentBuilderEnvironmentStructuredReplyNodeKey(reply.nodeKey) ||
    isAgentBuilderOptionalComponentStructuredReplyNodeKey(reply.nodeKey)
  ) {
    return "deterministic";
  }

  return isLatestPendingQuestionReply(context, reply.nodeKey) ? "llm" : "deterministic";
}

function createAgentBuilderSystemAgentPlanner(input: {
  readonly bindings: ApiBindings;
  readonly viewer: AuthenticatedViewer;
}): AgentBuilderLightweightPlanner {
  const llmPlanner = createAgentBuilderLlmPlanner(input);
  const structuredReplyPlanner = createDefaultAgentBuilderLightweightPlanner();
  let activePlanner: AgentBuilderLightweightPlanner = llmPlanner;

  return {
    get modelId() {
      return activePlanner.modelId ?? "agent-builder-system-agent";
    },
    plan(plannerInput) {
      activePlanner =
        selectAgentBuilderSystemAgentPlannerRoute(plannerInput.context) === "deterministic"
          ? structuredReplyPlanner
          : llmPlanner;

      return activePlanner.plan(plannerInput);
    },
    get provider() {
      return activePlanner.provider ?? "agent-builder-system-agent";
    },
  };
}

export function createAgentBuilderSystemAgentSubmitRuntime(input: {
  readonly bindings: ApiBindings;
  readonly planner?: AgentBuilderLightweightPlanner;
  readonly viewer: AuthenticatedViewer;
}): AgentBuilderSystemAgentSubmitMessageRuntime {
  return {
    planner:
      input.planner ??
      createAgentBuilderSystemAgentPlanner({
        bindings: input.bindings,
        viewer: input.viewer,
      }),
  };
}
