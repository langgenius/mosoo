import { forbiddenError } from "../../../platform/errors";
import type { AgentRow } from "../../agents/application/agent-types";
import { hasNonOwnerCollaborators } from "./mcp-agent-binding.repository";
import type { ServerRow } from "./mcp-types";

export async function ensureAgentCanUsePersonalServer(
  database: D1Database,
  agent: AgentRow,
  server: ServerRow,
): Promise<void> {
  if (server.source !== "personal") {
    return;
  }

  if (server.ownerId !== agent.ownerId) {
    throw forbiddenError("Personal MCP servers can only be bound to the owner's own agent.");
  }

  if (agent.status === "published" || (await hasNonOwnerCollaborators(database, agent.id))) {
    throw forbiddenError("Personal MCP bindings are only allowed on an owner-only agent.");
  }
}
