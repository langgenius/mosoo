import type { AgentDetail, AgentEditorState, AgentSummary } from "@mosoo/contracts/agent";
import { skipToken, useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";

import { toAgentId, toProjectId } from "@/routes/typed-id";

import { getAgent, getAgentEditorState, listVisibleAgents } from "../api/agent-client";

export const agentKeys = {
  all: ["agent"] as const,
  detail: (projectId: string | null, agentId: string | null) =>
    [...agentKeys.details(), projectId, agentId] as const,
  details: () => [...agentKeys.all, "detail"] as const,
  editorState: (projectId: string | null, agentId: string | null) =>
    [...agentKeys.editorStates(), projectId, agentId] as const,
  editorStates: () => [...agentKeys.all, "editor-state"] as const,
  list: (projectId: string | null) => [...agentKeys.lists(), projectId] as const,
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
    queryFn: projectId === null ? skipToken : async () => listVisibleAgents(toProjectId(projectId)),
    queryKey: agentKeys.list(projectId),
  });
}

export function useAgentDetailQuery(
  projectId: string | null,
  agentId: string | null,
): AgentDetailQueryResult {
  return useQuery({
    queryFn:
      projectId === null || agentId === null
        ? skipToken
        : async () => getAgent(toProjectId(projectId), toAgentId(agentId)),
    queryKey: agentKeys.detail(projectId, agentId),
  });
}

export function useAgentEditorStateQuery(
  projectId: string | null,
  agentId: string | null,
  enabled = true,
): AgentEditorStateQueryResult {
  return useQuery({
    queryFn:
      !enabled || projectId === null || agentId === null
        ? skipToken
        : async () => getAgentEditorState(toProjectId(projectId), toAgentId(agentId)),
    queryKey: agentKeys.editorState(projectId, agentId),
  });
}
