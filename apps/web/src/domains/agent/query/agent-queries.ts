import type { AgentDetail, AgentEditorState, AgentSummary } from "@mosoo/contracts/agent";
import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";

import { toAgentId, toProjectId } from "@/routes/typed-id";

import { getAgent, getAgentEditorState, listVisibleAgents } from "../api/agent-client";

export const agentKeys = {
  all: ["agent"] as const,
  detail: (projectId: string, agentId: string) =>
    [...agentKeys.details(), projectId, agentId] as const,
  details: () => [...agentKeys.all, "detail"] as const,
  editorState: (projectId: string, agentId: string) =>
    [...agentKeys.editorStates(), projectId, agentId] as const,
  editorStates: () => [...agentKeys.all, "editor-state"] as const,
  list: (projectId: string) => [...agentKeys.lists(), projectId] as const,
  lists: () => [...agentKeys.all, "list"] as const,
  manifest: (projectId: string, agentId: string) =>
    [...agentKeys.manifests(), projectId, agentId] as const,
  manifests: () => [...agentKeys.all, "manifest"] as const,
};

export type VisibleAgentsQueryResult = UseQueryResult<AgentSummary[]>;
export type AgentDetailQueryResult = UseQueryResult<AgentDetail>;
export type AgentEditorStateQueryResult = UseQueryResult<AgentEditorState>;

export function useVisibleAgentsQuery(projectId: string | null): VisibleAgentsQueryResult {
  return useQuery({
    enabled: projectId !== null,
    queryFn: async () => {
      if (projectId === null) {
        throw new Error("Project id is required to list visible agents.");
      }

      return listVisibleAgents(toProjectId(projectId));
    },
    queryKey: projectId === null ? [...agentKeys.lists(), "missing"] : agentKeys.list(projectId),
  });
}

export function useAgentDetailQuery(
  projectId: string | null,
  agentId: string | null,
): AgentDetailQueryResult {
  return useQuery({
    enabled: projectId !== null && agentId !== null,
    queryFn: async () => {
      if (projectId === null) {
        throw new Error("Project id is required to load agent details.");
      }

      if (agentId === null) {
        throw new Error("Agent id is required to load agent details.");
      }

      return getAgent(toProjectId(projectId), toAgentId(agentId));
    },
    queryKey:
      projectId === null || agentId === null
        ? [...agentKeys.details(), "missing"]
        : agentKeys.detail(projectId, agentId),
  });
}

export function useAgentEditorStateQuery(
  projectId: string | null,
  agentId: string | null,
  enabled = true,
): AgentEditorStateQueryResult {
  return useQuery({
    enabled: enabled && projectId !== null && agentId !== null,
    queryFn: async () => {
      if (projectId === null) {
        throw new Error("Project id is required to load editor state.");
      }

      if (agentId === null) {
        throw new Error("Agent id is required to load editor state.");
      }

      return getAgentEditorState(toProjectId(projectId), toAgentId(agentId));
    },
    queryKey:
      projectId === null || agentId === null
        ? [...agentKeys.editorStates(), "missing"]
        : agentKeys.editorState(projectId, agentId),
  });
}
