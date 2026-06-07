import { parseAgentBuilderPlannerOutputJson } from "@mosoo/contracts/agent-builder";

import { isAgentBuilderStreamingMessage } from "@/domains/agent-builder/api/agent-builder-chat-transport";
import type {
  AgentBuilderClientMessageId,
  AgentBuilderMessage,
} from "@/domains/agent-builder/api/agent-builder-client";

function plannerOutputHasPendingQuestion(message: AgentBuilderMessage): boolean {
  if (message.cardsJson === null) {
    return false;
  }

  const output = parseAgentBuilderPlannerOutputJson(message.cardsJson);

  if (output === null) {
    return false;
  }

  return output.nodes.some((node) => node.status === "pending" && node.askUser !== undefined);
}

export function getLatestActionableStructuredReplyMessageId(
  messages: readonly AgentBuilderMessage[],
): AgentBuilderClientMessageId | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (
      message === undefined ||
      message.role !== "assistant" ||
      isAgentBuilderStreamingMessage(message)
    ) {
      continue;
    }

    if (message.cardsJson === null) {
      continue;
    }

    return plannerOutputHasPendingQuestion(message) ? message.id : null;
  }

  return null;
}
