import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { toAgentId } from "@/routes/typed-id";

import {
  approveAgentBuilderStarterPack,
  ensureAgentBuilderThread,
  listAgentBuilderMessages,
} from "../api/agent-builder-client";
import type {
  AgentBuilderMessage,
  AgentBuilderStarterPackApprovalInput,
} from "../api/agent-builder-client";
import type { AgentBuilderSystemAgentAddress } from "../api/agent-builder-transport";

export const agentBuilderKeys = {
  all: ["agent-builder"] as const,
  messages: (agentId: string) => [...agentBuilderKeys.all, "messages", agentId] as const,
  thread: (agentId: string) => [...agentBuilderKeys.all, "thread", agentId] as const,
};

export function useEnsuredAgentBuilderThreadQuery(agentId: string | null) {
  return useQuery({
    enabled: agentId !== null,
    queryFn: async () => {
      if (agentId === null) {
        throw new Error("Agent id is required to load Agent Builder thread.");
      }

      return ensureAgentBuilderThread(toAgentId(agentId));
    },
    queryKey:
      agentId === null
        ? [...agentBuilderKeys.all, "thread", "none"]
        : agentBuilderKeys.thread(agentId),
  });
}

export function useAgentBuilderMessagesQuery(agentId: string | null) {
  return useQuery({
    enabled: agentId !== null,
    queryFn: async () => {
      if (agentId === null) {
        throw new Error("Agent id is required to load Agent Builder messages.");
      }

      return listAgentBuilderMessages({ agentId: toAgentId(agentId), limit: 50 });
    },
    queryKey:
      agentId === null
        ? [...agentBuilderKeys.all, "messages", "none"]
        : agentBuilderKeys.messages(agentId),
  });
}

export function useApproveAgentBuilderStarterPackMutation(
  agentId: string,
  systemAgent: AgentBuilderSystemAgentAddress | null,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (approval: AgentBuilderStarterPackApprovalInput) =>
      approveAgentBuilderStarterPack({
        agentId: toAgentId(agentId),
        approval,
        systemAgent,
      }),
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: agentBuilderKeys.thread(agentId) }),
        queryClient.invalidateQueries({ queryKey: agentBuilderKeys.messages(agentId) }),
      ]);
    },
    onSuccess: (turnMessages) => {
      queryClient.setQueryData<AgentBuilderMessage[]>(
        agentBuilderKeys.messages(agentId),
        (current) => mergeAgentBuilderMessages(current ?? [], turnMessages, []),
      );
    },
  });
}

export function mergeAgentBuilderMessages(
  currentMessages: readonly AgentBuilderMessage[],
  incomingMessages: readonly AgentBuilderMessage[],
  optimisticMessageIds: readonly string[],
): AgentBuilderMessage[] {
  const incomingIds = new Set(incomingMessages.map((message) => message.id));
  const optimisticIds = new Set(optimisticMessageIds);
  const retainedMessages = currentMessages.filter(
    (message) => !incomingIds.has(message.id) && !optimisticIds.has(message.id),
  );

  return [...retainedMessages, ...incomingMessages].toSorted((left, right) => {
    const seqDelta = left.seq - right.seq;

    return seqDelta === 0 ? left.createdAt.localeCompare(right.createdAt) : seqDelta;
  });
}
