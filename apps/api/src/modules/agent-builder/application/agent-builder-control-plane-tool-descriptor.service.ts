import type { AgentBuilderControlPlaneToolId } from "@mosoo/contracts/agent-builder";
import { AGENT_BUILDER_CONTROL_PLANE_TOOL_ID_VALUES } from "@mosoo/contracts/agent-builder";

export type AgentBuilderControlPlaneToolCategory = "action" | "interaction" | "mutation" | "read";

export interface AgentBuilderControlPlaneToolDescriptor {
  readonly category: AgentBuilderControlPlaneToolCategory;
  readonly description: string;
  readonly toolId: AgentBuilderControlPlaneToolId;
}

const DESCRIPTOR_BY_TOOL_ID = {
  apply_agent_config: descriptor("apply_agent_config", "mutation", {
    description: "Apply validated Manifest changes through the Agent config service.",
  }),
  ask_user: descriptor("ask_user", "interaction", {
    description: "Ask for structured single-select, multi-select, or free-text input.",
  }),
  create_agent: descriptor("create_agent", "mutation", {
    description: "Create or overwrite the base Agent Manifest fields for Quickstart Step 1.",
  }),
  create_environment: descriptor("create_environment", "mutation", {
    description:
      "Create an Environment directly by attaching createEnvironmentPayload { name, description? } to the action. Never include env var values, secrets, or setup scripts; users add those later in the Environment UI. Without a payload the action falls back to opening the creation UI.",
  }),
  create_remote_mcp_server: descriptor("create_remote_mcp_server", "mutation", {
    description:
      "Create a remote MCP server record directly by attaching createRemoteMcpServerPayload { name, url (https), authType: oauth|bearer, description? } to the action. Credentials are always connected by the user in the secure UI afterwards; never ask for or include tokens. Without a payload the action falls back to opening the creation UI.",
  }),
  inspect_builder_context: descriptor("inspect_builder_context", "read", {
    description: "Inspect the current Manifest, checklist, Preview state, and visible assets.",
  }),
  patch_manifest_draft: descriptor("patch_manifest_draft", "mutation", {
    description: "Patch one or more Manifest fields using the same guardrails as the editor.",
  }),
  reset_preview_session: descriptor("reset_preview_session", "mutation", {
    description: "Hard-delete the active Builder preview Session without changing Manifest config.",
  }),
  search_builder_assets: descriptor("search_builder_assets", "read", {
    description: "Search visible existing Skills, MCP servers, Spaces, and Environments.",
  }),
  show_next_action: descriptor("show_next_action", "action", {
    description: "Render a frontend button for allowed Builder workflow and control-plane actions.",
  }),
} as const satisfies Record<AgentBuilderControlPlaneToolId, AgentBuilderControlPlaneToolDescriptor>;

function descriptor(
  toolId: AgentBuilderControlPlaneToolId,
  category: AgentBuilderControlPlaneToolCategory,
  options: {
    readonly description: string;
  },
): AgentBuilderControlPlaneToolDescriptor {
  return {
    category,
    description: options.description,
    toolId,
  };
}

export function listAgentBuilderControlPlaneToolDescriptors(): AgentBuilderControlPlaneToolDescriptor[] {
  return AGENT_BUILDER_CONTROL_PLANE_TOOL_ID_VALUES.map((toolId) => DESCRIPTOR_BY_TOOL_ID[toolId]);
}

export function getAgentBuilderControlPlaneToolDescriptor(
  toolId: AgentBuilderControlPlaneToolId,
): AgentBuilderControlPlaneToolDescriptor {
  return DESCRIPTOR_BY_TOOL_ID[toolId];
}
