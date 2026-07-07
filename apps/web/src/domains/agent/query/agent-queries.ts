import type { AgentDetail, AgentEditorState, AgentSummary } from "@mosoo/contracts/agent";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { useCallback } from "react";

import type { AgentChannelBindingFieldsFragment } from "@/gql/graphql";
import { toAgentId, toAppId } from "@/routes/typed-id";

import {
  getAgent,
  getAgentEditorState,
  listAgentChannelBindings,
  listVisibleAgents,
} from "../api/agent-client";

export const agentKeys = {
  all: ["agent"] as const,
  detail: (appId: string, agentId: string) => [...agentKeys.details(), appId, agentId] as const,
  details: () => [...agentKeys.all, "detail"] as const,
  channelBindings: (appId: string, agentId: string) =>
    [...agentKeys.channelBindingLists(), appId, agentId] as const,
  channelBindingLists: () => [...agentKeys.all, "channel-bindings"] as const,
  editorState: (appId: string, agentId: string) =>
    [...agentKeys.editorStates(), appId, agentId] as const,
  editorStates: () => [...agentKeys.all, "editor-state"] as const,
  list: (appId: string) => [...agentKeys.lists(), appId] as const,
  lists: () => [...agentKeys.all, "list"] as const,
  manifest: (appId: string, agentId: string) => [...agentKeys.manifests(), appId, agentId] as const,
  manifests: () => [...agentKeys.all, "manifest"] as const,
};

export type VisibleAgentsQueryResult = UseQueryResult<AgentSummary[]>;
export type AgentDetailQueryResult = UseQueryResult<AgentDetail>;
export type AgentChannelBindingsQueryResult = UseQueryResult<AgentChannelBindingFieldsFragment[]>;
export type AgentEditorStateQueryResult = UseQueryResult<AgentEditorState>;

export function useVisibleAgentsQuery(appId: string | null): VisibleAgentsQueryResult {
  return useQuery({
    enabled: appId !== null,
    queryFn: async () => {
      if (appId === null) {
        throw new Error("App id is required to list visible agents.");
      }

      return listVisibleAgents(toAppId(appId));
    },
    queryKey: appId === null ? [...agentKeys.lists(), "missing"] : agentKeys.list(appId),
  });
}

export function useAgentDetailQuery(
  appId: string | null,
  agentId: string | null,
): AgentDetailQueryResult {
  return useQuery({
    enabled: appId !== null && agentId !== null,
    queryFn: async () => {
      if (appId === null) {
        throw new Error("App id is required to load agent details.");
      }

      if (agentId === null) {
        throw new Error("Agent id is required to load agent details.");
      }

      return getAgent(toAppId(appId), toAgentId(agentId));
    },
    queryKey:
      appId === null || agentId === null
        ? [...agentKeys.details(), "missing"]
        : agentKeys.detail(appId, agentId),
  });
}

export function useAgentEditorStateQuery(
  appId: string | null,
  agentId: string | null,
  enabled = true,
): AgentEditorStateQueryResult {
  return useQuery({
    enabled: enabled && appId !== null && agentId !== null,
    queryFn: async () => {
      if (appId === null) {
        throw new Error("App id is required to load editor state.");
      }

      if (agentId === null) {
        throw new Error("Agent id is required to load editor state.");
      }

      return getAgentEditorState(toAppId(appId), toAgentId(agentId));
    },
    queryKey:
      appId === null || agentId === null
        ? [...agentKeys.editorStates(), "missing"]
        : agentKeys.editorState(appId, agentId),
  });
}

export function useInvalidateAgentChannelBindings(
  appId: string,
  agentId: string,
): () => Promise<void> {
  const queryClient = useQueryClient();

  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: agentKeys.channelBindings(appId, agentId) }),
    [agentId, appId, queryClient],
  );
}

export function useAgentChannelBindingsQuery(
  appId: string | null,
  agentId: string | null,
  enabled = true,
): AgentChannelBindingsQueryResult {
  return useQuery({
    enabled: enabled && appId !== null && agentId !== null,
    queryFn: async () => {
      if (appId === null) {
        throw new Error("App id is required to load channel bindings.");
      }

      if (agentId === null) {
        throw new Error("Agent id is required to load channel bindings.");
      }

      return listAgentChannelBindings(toAppId(appId), toAgentId(agentId));
    },
    queryKey:
      appId === null || agentId === null
        ? [...agentKeys.channelBindingLists(), "missing"]
        : agentKeys.channelBindings(appId, agentId),
  });
}
