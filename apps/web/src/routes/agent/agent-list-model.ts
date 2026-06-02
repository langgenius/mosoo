import type { Scope } from "@/shared/ui/scope-tabs";

import type { Agent } from "./agent.types";

export interface AgentScopeGroups {
  myAgents: Agent[];
  sharedAgents: Agent[];
}

export function groupAgentsByScope(agents: Agent[]): AgentScopeGroups {
  return {
    myAgents: agents.filter((agent) => agent.role === "owner" || agent.role === "admin"),
    sharedAgents: agents.filter((agent) => agent.role === "user"),
  };
}

export function getAgentsForScope(groups: AgentScopeGroups, scope: Scope): Agent[] {
  return scope === "shared" ? groups.sharedAgents : groups.myAgents;
}

export function filterAgents(agents: Agent[], search: string): Agent[] {
  const query = search.trim().toLowerCase();

  if (!query) {
    return agents;
  }

  return agents.filter(
    (agent) =>
      agent.name.toLowerCase().includes(query) || agent.description.toLowerCase().includes(query),
  );
}
