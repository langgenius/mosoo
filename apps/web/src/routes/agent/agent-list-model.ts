import type { Agent } from "./agent.types";

export function selectOwnedAgents(agents: Agent[]): Agent[] {
  return agents.filter((agent) => agent.role === "owner" || agent.role === "admin");
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
