import { graphql } from "@/gql";

export const ENSURE_AGENT_BUILDER_THREAD_MUTATION = graphql(/* GraphQL */ `
  mutation EnsureAgentBuilderThread($agentId: ULID!) {
    ensureAgentBuilderThread(agentId: $agentId) {
      agentId
      createdAt
      creatorAccountId
      id
      lastTurnAt
      organizationId
      status
      title
      updatedAt
    }
  }
`);

export const EXECUTE_AGENT_BUILDER_CONTROL_PLANE_ACTION_MUTATION = graphql(/* GraphQL */ `
  mutation ExecuteAgentBuilderControlPlaneAction(
    $input: ExecuteAgentBuilderControlPlaneActionInput!
  ) {
    executeAgentBuilderControlPlaneAction(input: $input) {
      createdEnvironment {
        id
        name
      }
      createdMcpServer {
        authType
        id
        name
        url
      }
      message
      secureUi {
        kind
        mcpServerId
      }
      sessionId
      status
      toolId
    }
  }
`);

export const AGENT_BUILDER_MESSAGES_QUERY = graphql(/* GraphQL */ `
  query AgentBuilderMessages($agentId: ULID!, $beforeSeq: Int, $limit: Int) {
    agentBuilderMessages(agentId: $agentId, beforeSeq: $beforeSeq, limit: $limit) {
      cardsJson
      contentText
      createdAt
      createdByAccountId
      id
      inputKind
      plannerRunId
      role
      seq
      threadId
    }
  }
`);
