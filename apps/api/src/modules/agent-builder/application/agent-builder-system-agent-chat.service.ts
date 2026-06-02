import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import type { UIMessage } from "ai";

import type { AgentBuilderProgressReporter } from "./agent-builder-progress.service";
import type { AgentBuilderSystemAgentRpcResult } from "./agent-builder-system-agent-rpc.service";
import { INITIAL_AGENT_BUILDER_SYSTEM_AGENT_STATE } from "./agent-builder-system-agent-state.service";
import {
  createFailedAgentBuilderSystemAgentTerminalResult,
  formatAgentBuilderSystemAgentTerminalError,
} from "./agent-builder-system-agent-terminal.service";
import type { AgentBuilderSystemAgentTerminalFailureKind } from "./agent-builder-system-agent-terminal.service";

type AgentBuilderSystemAgentChatDataParts = {
  "builder-result": AgentBuilderSystemAgentRpcResult;
};

type AgentBuilderSystemAgentChatMessage = UIMessage<unknown, AgentBuilderSystemAgentChatDataParts>;

interface AgentBuilderSystemAgentChatResponseRun {
  readonly run: (
    progress: AgentBuilderProgressReporter,
  ) => AgentBuilderSystemAgentRpcResult | Promise<AgentBuilderSystemAgentRpcResult>;
  readonly signal?: AbortSignal;
}

function splitTextForStreaming(text: string): string[] {
  if (text.length === 0) {
    return [];
  }

  const chunkSize = Math.max(1, Math.ceil(text.length / 80));
  const chunks: string[] = [];

  for (let index = 0; index < text.length; index += chunkSize) {
    chunks.push(text.slice(index, index + chunkSize));
  }

  return chunks;
}

function readAssistantText(result: AgentBuilderSystemAgentRpcResult): string {
  return (
    result.messages
      .toReversed()
      .find((message) => message.role === "assistant")
      ?.contentText.trim() ?? ""
  );
}

function isChatResponseRun(value: unknown): value is AgentBuilderSystemAgentChatResponseRun {
  return (
    value !== null && typeof value === "object" && "run" in value && typeof value.run === "function"
  );
}

function isAbortSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

async function resolveChatResponseResult(
  input: AgentBuilderSystemAgentRpcResult | AgentBuilderSystemAgentChatResponseRun,
  progress: AgentBuilderProgressReporter,
): Promise<AgentBuilderSystemAgentRpcResult> {
  if (!isChatResponseRun(input)) {
    return input;
  }

  const signal = input.signal;

  if (isAbortSignalAborted(signal)) {
    throw new Error("Agent Builder System Agent stream was closed.");
  }

  const result = await input.run(progress);

  if (isAbortSignalAborted(signal)) {
    throw new Error("Agent Builder System Agent stream was closed.");
  }

  return result;
}

function classifyStreamFailure(
  input: AgentBuilderSystemAgentRpcResult | AgentBuilderSystemAgentChatResponseRun,
): AgentBuilderSystemAgentTerminalFailureKind {
  return isChatResponseRun(input) && input.signal?.aborted === true
    ? "transport_close"
    : "model_failure";
}

function createFailedChatResult(input: {
  readonly failureKind: AgentBuilderSystemAgentTerminalFailureKind;
  readonly message: string;
}): AgentBuilderSystemAgentRpcResult {
  return {
    messages: [],
    state: INITIAL_AGENT_BUILDER_SYSTEM_AGENT_STATE,
    terminal: createFailedAgentBuilderSystemAgentTerminalResult(input),
  };
}

export function createAgentBuilderSystemAgentChatResponse(
  input: AgentBuilderSystemAgentRpcResult | AgentBuilderSystemAgentChatResponseRun,
): Response {
  const stream = createUIMessageStream<AgentBuilderSystemAgentChatMessage>({
    execute: async ({ writer }) => {
      const textId = "agent-builder-assistant-text";
      let hasProgressText = false;
      const writeTextDelta = (delta: string) => {
        writer.write({
          delta,
          id: textId,
          type: "text-delta",
        });
      };
      const progress: AgentBuilderProgressReporter = (event) => {
        hasProgressText = true;
        writeTextDelta(`${event.message}\n`);
      };

      writer.write({
        id: textId,
        type: "text-start",
      });

      let result: AgentBuilderSystemAgentRpcResult;

      try {
        result = await resolveChatResponseResult(input, progress);
      } catch (error) {
        const message = formatAgentBuilderSystemAgentTerminalError(error);

        result = createFailedChatResult({
          failureKind: classifyStreamFailure(input),
          message,
        });
        writeTextDelta(message);
      }

      const assistantText = readAssistantText(result);

      if (hasProgressText && assistantText.length > 0) {
        writeTextDelta("\n");
      }

      for (const delta of splitTextForStreaming(assistantText)) {
        writeTextDelta(delta);
      }

      writer.write({
        id: textId,
        type: "text-end",
      });

      writer.write({
        data: result,
        id: "agent-builder-result",
        type: "data-builder-result",
      });

      writer.write({
        finishReason: "stop",
        type: "finish",
      });
    },
  });

  return createUIMessageStreamResponse({
    stream,
  });
}
