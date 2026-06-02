import type { AgentDetail, AgentEditorState, AgentSummary } from "@mosoo/contracts/agent";
import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";

import type { AgentChannelBindingFieldsFragment } from "@/gql/graphql";
import { toAgentId, toOrganizationId } from "@/routes/typed-id";

import {
  getAgent,
  getAgentEditorState,
  listAgentChannelBindings,
  listVisibleAgents,
} from "../api/agent-client";

export const agentKeys = {
  all: ["agent"] as const,
  detail: (agentId: string) => [...agentKeys.details(), agentId] as const,
  details: () => [...agentKeys.all, "detail"] as const,
  channelBindings: (agentId: string) => [...agentKeys.channelBindingLists(), agentId] as const,
  channelBindingLists: () => [...agentKeys.all, "channel-bindings"] as const,
  editorState: (agentId: string) => [...agentKeys.editorStates(), agentId] as const,
  editorStates: () => [...agentKeys.all, "editor-state"] as const,
  list: (organizationId: string) => [...agentKeys.lists(), organizationId] as const,
  lists: () => [...agentKeys.all, "list"] as const,
  manifest: (agentId: string) => [...agentKeys.manifests(), agentId] as const,
  manifests: () => [...agentKeys.all, "manifest"] as const,
};

export type VisibleAgentsQueryResult = UseQueryResult<AgentSummary[]>;
export type AgentDetailQueryResult = UseQueryResult<AgentDetail>;
export type AgentChannelBindingsQueryResult = UseQueryResult<AgentChannelBindingFieldsFragment[]>;
export type AgentEditorStateQueryResult = UseQueryResult<AgentEditorState>;

export function useVisibleAgentsQuery(organizationId: string | null): VisibleAgentsQueryResult {
  return useQuery({
    enabled: organizationId !== null,
    queryFn: async () => {
      if (organizationId === null) {
        throw new Error("Organization id is required to list visible agents.");
      }

      return listVisibleAgents(toOrganizationId(organizationId));
    },
    queryKey:
      organizationId === null ? [...agentKeys.lists(), "missing"] : agentKeys.list(organizationId),
  });
}

export function useAgentDetailQuery(agentId: string | null): AgentDetailQueryResult {
  return useQuery({
    enabled: agentId !== null,
    queryFn: async () => {
      if (agentId === null) {
        throw new Error("Agent id is required to load agent details.");
      }

      return getAgent(toAgentId(agentId));
    },
    queryKey: agentId === null ? [...agentKeys.details(), "missing"] : agentKeys.detail(agentId),
  });
}

export function useAgentEditorStateQuery(
  agentId: string | null,
  enabled = true,
): AgentEditorStateQueryResult {
  return useQuery({
    enabled: enabled && agentId !== null,
    queryFn: async () => {
      if (agentId === null) {
        throw new Error("Agent id is required to load editor state.");
      }

      return getAgentEditorState(toAgentId(agentId));
    },
    queryKey:
      agentId === null ? [...agentKeys.editorStates(), "missing"] : agentKeys.editorState(agentId),
  });
}

export function useAgentChannelBindingsQuery(
  agentId: string | null,
  enabled = true,
): AgentChannelBindingsQueryResult {
  return useQuery({
    enabled: enabled && agentId !== null,
    queryFn: async () => {
      if (agentId === null) {
        throw new Error("Agent id is required to load channel bindings.");
      }

      return listAgentChannelBindings(toAgentId(agentId));
    },
    queryKey:
      agentId === null
        ? [...agentKeys.channelBindingLists(), "missing"]
        : agentKeys.channelBindings(agentId),
  });
}
