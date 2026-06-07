import { AGENT_BUILDER_EXECUTABLE_ACTION_TOOL_ID_VALUES } from "@mosoo/contracts/agent-builder";
import { AGENT_BUILDER_MESSAGE_ROLES, AGENT_BUILDER_THREAD_STATUSES } from "@mosoo/db";

function formatEnumValues(values: readonly string[]): string {
  return values.map((value) => `    ${value}`).join("\n");
}

export const agentBuilderSchema = /* GraphQL */ `
  enum AgentBuilderControlPlaneActionStatus {
    applied
    needs_secure_ui
    noop
  }

  enum AgentBuilderExecutableActionToolId {
${formatEnumValues(AGENT_BUILDER_EXECUTABLE_ACTION_TOOL_ID_VALUES)}
  }

  enum AgentBuilderSecureUiActionKind {
    create_environment
    create_remote_mcp_server
  }

  type AgentBuilderSecureUiAction {
    kind: AgentBuilderSecureUiActionKind!
  }

  enum AgentBuilderThreadStatus {
${formatEnumValues(AGENT_BUILDER_THREAD_STATUSES)}
  }

  enum AgentBuilderMessageRole {
${formatEnumValues(AGENT_BUILDER_MESSAGE_ROLES)}
  }

  type AgentBuilderThread {
    agentId: ULID!
    createdAt: String!
    creatorAccountId: ULID!
    id: ULID!
    lastTurnAt: String
    organizationId: ULID!
    status: AgentBuilderThreadStatus!
    title: String
    updatedAt: String!
  }

  type AgentBuilderMessage {
    cardsJson: String
    contentText: String!
    createdAt: String!
    createdByAccountId: ULID
    id: ULID!
    inputKind: String
    plannerRunId: ULID
    role: AgentBuilderMessageRole!
    seq: Int!
    threadId: ULID!
  }

  type AgentBuilderControlPlaneActionResult {
    message: String!
    secureUi: AgentBuilderSecureUiAction
    sessionId: ULID
    status: AgentBuilderControlPlaneActionStatus!
    toolId: AgentBuilderExecutableActionToolId!
  }

  input ExecuteAgentBuilderControlPlaneActionInput {
    agentId: ULID!
    draftYaml: String
    toolId: AgentBuilderExecutableActionToolId!
  }
`;
