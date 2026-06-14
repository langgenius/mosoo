import type { Agent } from "./agent.types";

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
