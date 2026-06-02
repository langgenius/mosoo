import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useQueryClient } from "@tanstack/react-query";
import { useAgent } from "agents/react";
import { useCallback, useRef, useState } from "react";

import { toAgentId } from "@/routes/typed-id";

import {
  createAgentBuilderSystemAgentChatRequestBody,
  createAgentBuilderSystemAgentChatResultKey,
  enqueueAgentBuilderSystemAgentChatResult,
  isAgentBuilderRecoveredSdkRenderError,
  isAgentBuilderSystemAgentChatResultPart,
  mapAgentBuilderChatMessagesToStreamingMessages,
} from "../api/agent-builder-chat-transport";
import type {
  AgentBuilderPendingChatTurn,
  AgentBuilderSystemAgentChatMessage,
  AgentBuilderSystemAgentChatResult,
} from "../api/agent-builder-chat-transport";
import type { AgentBuilderMessage } from "../api/agent-builder-client";
import type { AgentBuilderSystemAgentAddress } from "../api/agent-builder-transport";
import { resolveAgentBuilderSystemAgentAddress } from "../api/agent-builder-transport";
import {
  agentBuilderKeys,
  mergeAgentBuilderMessages,
  useAgentBuilderMessagesQuery,
  useEnsuredAgentBuilderThreadQuery,
} from "./agent-builder-queries";

const EMPTY_SYSTEM_AGENT_CHAT_MESSAGES: AgentBuilderSystemAgentChatMessage[] = [];

export interface AgentBuilderSystemAgentSessionInput {
  readonly agentId: string;
  readonly draftRevision: string;
  readonly draftYaml: string;
  readonly onError: (message: string) => void;
  readonly onTurnMessages: (messages: AgentBuilderMessage[]) => void | Promise<void>;
}

export interface AgentBuilderSystemAgentSession {
  readonly historyError: Error | null;
  readonly isBusy: boolean;
  readonly messages: AgentBuilderMessage[];
  readonly submitTurn: (inputText: string) => void;
  readonly systemAgent: AgentBuilderSystemAgentAddress | null;
  readonly visibleChatError: Error | undefined;
}

export function useAgentBuilderSystemAgentSession(
  input: AgentBuilderSystemAgentSessionInput,
): AgentBuilderSystemAgentSession {
  const { agentId, draftRevision, draftYaml, onError, onTurnMessages } = input;
  const typedAgentId = toAgentId(agentId);
  const [pendingChatTurn, setPendingChatTurn] = useState<AgentBuilderPendingChatTurn | null>(null);
  const optimisticTurnCounterRef = useRef(0);
  const processedChatResultKeysRef = useRef<Set<string>>(new Set());
  const queuedChatResultKeysRef = useRef<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const threadQuery = useEnsuredAgentBuilderThreadQuery(agentId);
  const messagesQuery = useAgentBuilderMessagesQuery(agentId);
  const systemAgent = resolveAgentBuilderSystemAgentAddress({
    agentId: typedAgentId,
    threadId: threadQuery.data?.id ?? null,
  });
  const applySystemAgentChatResult = useCallback(
    (result: AgentBuilderSystemAgentChatResult) => {
      const resultKey = createAgentBuilderSystemAgentChatResultKey(result);

      queuedChatResultKeysRef.current.delete(resultKey);

      if (processedChatResultKeysRef.current.has(resultKey)) {
        return;
      }

      processedChatResultKeysRef.current.add(resultKey);
      setPendingChatTurn(null);
      queryClient.setQueryData<AgentBuilderMessage[]>(
        agentBuilderKeys.messages(agentId),
        (current) => mergeAgentBuilderMessages(current ?? [], result.messages, []),
      );
      void queryClient.invalidateQueries({ queryKey: agentBuilderKeys.thread(agentId) });
      void queryClient.invalidateQueries({ queryKey: agentBuilderKeys.messages(agentId) });
      void onTurnMessages([...result.messages]);
    },
    [agentId, onTurnMessages, queryClient],
  );
  const handleSystemAgentChatData = useCallback(
    (part: { readonly data?: unknown; readonly type: string }) => {
      if (!isAgentBuilderSystemAgentChatResultPart(part)) {
        return;
      }

      const resultKey = createAgentBuilderSystemAgentChatResultKey(part.data);

      if (
        processedChatResultKeysRef.current.has(resultKey) ||
        queuedChatResultKeysRef.current.has(resultKey)
      ) {
        return;
      }

      queuedChatResultKeysRef.current.add(resultKey);
      enqueueAgentBuilderSystemAgentChatResult({
        onResult: applySystemAgentChatResult,
        part,
      });
    },
    [applySystemAgentChatResult],
  );
  const systemAgentConnection = useAgent({
    agent: "AgentBuilderSystemAgent",
    basePath: systemAgent?.basePath ?? "api/agents/agent-builder-system-agent/offline",
    enabled: systemAgent !== null,
  });
  const systemAgentChat = useAgentChat<unknown, AgentBuilderSystemAgentChatMessage>({
    agent: systemAgentConnection,
    credentials: "include",
    getInitialMessages: null,
    messages: EMPTY_SYSTEM_AGENT_CHAT_MESSAGES,
    onData: handleSystemAgentChatData,
    resume: false,
  });
  const isBusy =
    systemAgent !== null &&
    (systemAgentChat.status === "submitted" ||
      systemAgentChat.status === "streaming" ||
      systemAgentChat.isStreaming);
  const canonicalMessages = messagesQuery.data ?? [];
  const streamingMessages =
    (isBusy || pendingChatTurn !== null) && threadQuery.data?.id !== undefined
      ? mapAgentBuilderChatMessagesToStreamingMessages({
          chatMessages: systemAgentChat.messages,
          pendingTurn: pendingChatTurn,
          threadId: threadQuery.data.id,
        })
      : [];
  const historyError =
    threadQuery.error instanceof Error
      ? threadQuery.error
      : messagesQuery.error instanceof Error
        ? messagesQuery.error
        : null;
  const visibleChatError = isAgentBuilderRecoveredSdkRenderError(systemAgentChat.error)
    ? undefined
    : systemAgentChat.error;
  const submitTurn = useCallback(
    (submittedInput: string) => {
      systemAgentChat.clearError();

      if (systemAgent === null || threadQuery.data?.id === undefined) {
        onError("Agent Builder thread is still loading.");
        return;
      }

      optimisticTurnCounterRef.current += 1;
      setPendingChatTurn({
        chatMessageStartIndex: systemAgentChat.messages.length,
        inputText: submittedInput,
        threadId: threadQuery.data.id,
        turnId: String(optimisticTurnCounterRef.current),
      });

      void systemAgentChat
        .sendMessage(
          { text: submittedInput },
          {
            body: createAgentBuilderSystemAgentChatRequestBody({
              agentId: typedAgentId,
              draftRevision,
              draftYaml,
              threadId: threadQuery.data.id,
            }),
          },
        )
        .catch((error: unknown) => {
          setPendingChatTurn(null);
          onError(error instanceof Error ? error.message : "System Agent streaming failed.");
        });
    },
    [
      agentId,
      draftRevision,
      draftYaml,
      onError,
      systemAgent,
      systemAgentChat,
      threadQuery.data?.id,
      typedAgentId,
    ],
  );

  return {
    historyError,
    isBusy,
    messages: mergeAgentBuilderMessages(canonicalMessages, streamingMessages, []),
    submitTurn,
    systemAgent,
    visibleChatError,
  };
}
