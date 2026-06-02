import {
  AGENT_BUILDER_TOOL_ID_VALUES,
  createAgentBuilderWorkflowToolApprovalPolicy,
  getAgentBuilderWorkflowToolApprovalMode,
} from "@mosoo/contracts/agent-builder";
import type {
  AgentBuilderApprovalMode,
  AgentBuilderApprovalPolicy,
  AgentBuilderToolId,
  AgentBuilderWorkflowToolExecutionPolicy,
} from "@mosoo/contracts/agent-builder";

export type AgentBuilderWorkflowToolCategory =
  | "client"
  | "commit"
  | "event"
  | "interaction"
  | "prepare"
  | "read"
  | "resolve"
  | "validate";

export interface AgentBuilderWorkflowToolDescriptor {
  readonly approvalMode: AgentBuilderApprovalMode;
  readonly approvalPolicy: AgentBuilderApprovalPolicy;
  readonly builderAssembly: "excluded" | "included";
  readonly builderAssemblyExclusionReason?: string;
  readonly category: AgentBuilderWorkflowToolCategory;
  readonly description: string;
  readonly destructive: boolean;
  readonly executionPolicy: AgentBuilderWorkflowToolExecutionPolicy;
  readonly toolId: AgentBuilderToolId;
}

const DESCRIPTORS = [
  descriptor("apply_safe_patch", "client", "client_only", "excluded", {
    description: "Apply an admitted Draft Patch in the browser-owned Draft editor state.",
    reason: "Patch application remains a frontend action, not a Code Mode tool.",
  }),
  descriptor("ask_user", "interaction", "safe_automatic", "included", {
    description: "Return a structured Question Card or clarification request.",
  }),
  descriptor("check_model_availability", "resolve", "safe_automatic", "excluded", {
    description: "Check whether a requested runtime, provider, or model can be selected.",
    reason:
      "No Builder Assembly runtime tool is registered; Draft validation is covered by dry_run_draft_patch.",
  }),
  descriptor("check_readiness", "validate", "safe_automatic", "excluded", {
    description: "Evaluate whether the current or patched Agent Draft is ready.",
    reason:
      "No Builder Assembly runtime tool is registered; Draft validation is covered by dry_run_draft_patch.",
  }),
  descriptor("commit_channel_setup", "commit", "approval_required", "excluded", {
    description: "Commit a Channel setup after explicit approval.",
    destructive: true,
    reason: "Builder Assembly does not create or mutate channel setup.",
  }),
  descriptor("commit_create_environment", "commit", "approval_required", "excluded", {
    description: "Create an Environment through the real Environment service.",
    destructive: true,
    reason: "Builder Assembly cannot create Environment assets.",
  }),
  descriptor("commit_create_mcp_server", "commit", "approval_required", "excluded", {
    description: "Create an MCP server asset after explicit approval.",
    destructive: true,
    reason: "Builder Assembly cannot create MCP assets.",
  }),
  descriptor("commit_create_skill", "commit", "approval_required", "excluded", {
    description: "Create a Skill asset after explicit approval.",
    destructive: true,
    reason: "Builder Assembly cannot create Skill assets.",
  }),
  descriptor("commit_create_space", "commit", "approval_required", "excluded", {
    description: "Create a Space through the real Space service.",
    destructive: true,
    reason: "Builder Assembly cannot create Space assets.",
  }),
  descriptor("commit_terminal_action", "commit", "approval_required", "excluded", {
    description: "Commit a terminal action after explicit approval.",
    destructive: true,
    reason: "Builder Assembly does not launch runtime or terminal actions.",
  }),
  descriptor("dry_run_draft_patch", "validate", "safe_automatic", "included", {
    description: "Simulate a Draft Patch and run readiness guardrails before final output.",
  }),
  descriptor("get_asset_detail", "read", "safe_automatic", "included", {
    description: "Read details for a visible existing Builder asset.",
  }),
  descriptor("get_builder_context", "read", "safe_automatic", "excluded", {
    description: "Read broad Builder context.",
    reason: "Builder Assembly should receive scoped context and use asset search/detail tools.",
  }),
  descriptor("get_draft_snapshot", "read", "safe_automatic", "included", {
    description: "Read the current Agent Draft snapshot and editable field summary.",
  }),
  descriptor("open_authorization_flow", "client", "client_only", "excluded", {
    description: "Request a browser-side authorization flow.",
    reason: "Builder Assembly can surface configuration links but cannot drive browser OAuth.",
  }),
  descriptor("prepare_bind_environment_patch", "prepare", "safe_automatic", "included", {
    description: "Prepare a Draft Patch that binds an existing visible Environment.",
  }),
  descriptor("prepare_bind_mcp_patch", "prepare", "safe_automatic", "included", {
    description: "Prepare a Draft Patch that binds an existing visible MCP server.",
  }),
  descriptor("prepare_bind_skill_patch", "prepare", "safe_automatic", "included", {
    description: "Prepare a Draft Patch that binds an existing visible Skill.",
  }),
  descriptor("prepare_bind_space_patch", "prepare", "safe_automatic", "included", {
    description: "Prepare a Draft Patch that binds an existing visible Space.",
  }),
  descriptor("prepare_channel_setup", "prepare", "safe_automatic", "excluded", {
    description: "Prepare a Channel setup plan.",
    reason: "Builder Assembly does not configure channels.",
  }),
  descriptor("prepare_create_environment", "prepare", "safe_automatic", "excluded", {
    description: "Prepare an Environment creation plan.",
    reason: "Builder Assembly recommends only existing Environments.",
  }),
  descriptor("prepare_create_mcp_server", "prepare", "safe_automatic", "excluded", {
    description: "Prepare an MCP server creation plan.",
    reason: "Builder Assembly recommends only existing MCP assets.",
  }),
  descriptor("prepare_create_skill", "prepare", "safe_automatic", "excluded", {
    description: "Prepare a Skill creation plan.",
    reason: "Builder Assembly recommends only existing Skills.",
  }),
  descriptor("prepare_create_space", "prepare", "safe_automatic", "excluded", {
    description: "Prepare a Space creation plan.",
    reason: "Builder Assembly recommends only existing Spaces.",
  }),
  descriptor("prepare_draft_patch", "prepare", "safe_automatic", "included", {
    description: "Prepare Draft field changes such as name, description, prompt, or model.",
  }),
  descriptor("prepare_secret_requirement", "prepare", "safe_automatic", "excluded", {
    description: "Prepare guidance for required secret configuration.",
    reason: "Builder Assembly must use external setup links and never handle secret values.",
  }),
  descriptor("prepare_replace_skill_patch", "prepare", "safe_automatic", "included", {
    description: "Prepare a Draft Patch that replaces existing Skill bindings.",
  }),
  descriptor("prepare_terminal_action", "prepare", "safe_automatic", "excluded", {
    description: "Prepare a terminal action plan.",
    reason: "Builder Assembly does not launch runtime or terminal actions.",
  }),
  descriptor("record_builder_event", "event", "safe_automatic", "excluded", {
    description: "Record internal Builder workflow events.",
    reason: "Workflow tracing is owned by Host Runtime, not generated workflow code.",
  }),
  descriptor("resolve_asset_reference", "resolve", "safe_automatic", "included", {
    description: "Resolve user-facing asset references into visible existing asset IDs.",
  }),
  descriptor("return_blocked", "interaction", "safe_automatic", "included", {
    description: "Return a structured blocked result with a clear reason and next step.",
  }),
  descriptor("search_assets", "read", "safe_automatic", "included", {
    description: "Search visible existing Builder assets by type, query, and binding state.",
  }),
  descriptor("search_space_files", "read", "safe_automatic", "excluded", {
    description: "Search files inside visible or already-bound Spaces.",
    reason: "Builder Assembly does not expose per-file Space browsing to Code Mode.",
  }),
] as const satisfies readonly AgentBuilderWorkflowToolDescriptor[];

const DESCRIPTOR_BY_TOOL_ID = new Map<AgentBuilderToolId, AgentBuilderWorkflowToolDescriptor>(
  DESCRIPTORS.map((descriptorValue) => [descriptorValue.toolId, descriptorValue]),
);

function descriptor(
  toolId: AgentBuilderToolId,
  category: AgentBuilderWorkflowToolCategory,
  executionPolicy: AgentBuilderWorkflowToolExecutionPolicy,
  builderAssembly: AgentBuilderWorkflowToolDescriptor["builderAssembly"],
  options: {
    description: string;
    destructive?: boolean;
    reason?: string;
  },
): AgentBuilderWorkflowToolDescriptor {
  const destructive = options.destructive ?? false;
  const descriptorValue: AgentBuilderWorkflowToolDescriptor = {
    approvalMode: getAgentBuilderWorkflowToolApprovalMode(executionPolicy),
    approvalPolicy: createAgentBuilderWorkflowToolApprovalPolicy({
      destructive,
      executionPolicy,
      toolId,
    }),
    builderAssembly,
    category,
    description: options.description,
    destructive,
    executionPolicy,
    toolId,
  };

  if (options.reason !== undefined) {
    return {
      ...descriptorValue,
      builderAssemblyExclusionReason: options.reason,
    };
  }

  return descriptorValue;
}

export function listAgentBuilderWorkflowToolDescriptors(): AgentBuilderWorkflowToolDescriptor[] {
  return [...DESCRIPTORS];
}

export function getAgentBuilderWorkflowToolDescriptor(
  toolId: AgentBuilderToolId,
): AgentBuilderWorkflowToolDescriptor {
  const descriptorValue = DESCRIPTOR_BY_TOOL_ID.get(toolId);

  if (descriptorValue === undefined) {
    throw new Error(`Missing Agent Builder workflow tool descriptor for ${toolId}.`);
  }

  return descriptorValue;
}

export function listAgentBuilderAssemblyToolDescriptors(): AgentBuilderWorkflowToolDescriptor[] {
  return DESCRIPTORS.filter((descriptorValue) => descriptorValue.builderAssembly === "included");
}

export function listAgentBuilderAssemblyToolIds(): AgentBuilderToolId[] {
  return listAgentBuilderAssemblyToolDescriptors().map((descriptorValue) => descriptorValue.toolId);
}

export function assertAgentBuilderWorkflowToolDescriptorCoverage(): void {
  const descriptorIds = new Set(DESCRIPTORS.map((descriptorValue) => descriptorValue.toolId));

  for (const toolId of AGENT_BUILDER_TOOL_ID_VALUES) {
    if (!descriptorIds.has(toolId)) {
      throw new Error(`Missing Agent Builder workflow tool descriptor for ${toolId}.`);
    }
  }

  if (descriptorIds.size !== AGENT_BUILDER_TOOL_ID_VALUES.length) {
    throw new Error("Agent Builder workflow tool descriptors contain duplicate tool IDs.");
  }

  for (const descriptorValue of DESCRIPTORS) {
    if (descriptorValue.destructive && descriptorValue.approvalMode !== "single_only") {
      throw new Error(
        `Agent Builder workflow tool ${descriptorValue.toolId} is destructive without single approval.`,
      );
    }

    if (descriptorValue.executionPolicy === "approval_required" && !descriptorValue.destructive) {
      throw new Error(
        `Agent Builder workflow tool ${descriptorValue.toolId} requires approval but is not marked destructive.`,
      );
    }
  }
}
