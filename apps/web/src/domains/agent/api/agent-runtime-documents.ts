import { graphql } from "@/gql";

export const PUBLISH_AGENT_MUTATION = graphql(/* GraphQL */ `
  mutation PublishAgent($input: PublishAgentInput!) {
    publishAgent(input: $input) {
      ...AgentFields
    }
  }
`);

export const UNPUBLISH_AGENT_MUTATION = graphql(/* GraphQL */ `
  mutation UnpublishAgent($agentId: ULID!, $appId: ULID!) {
    unpublishAgent(agentId: $agentId, appId: $appId) {
      ...AgentFields
    }
  }
`);

export const RESTART_DRIVER_MUTATION = graphql(/* GraphQL */ `
  mutation RestartDriver($input: RuntimeStateOperationInput!) {
    restartDriver(input: $input) {
      affectedSessionCount
      agentId
      ok
      operation
    }
  }
`);

export const RECREATE_SANDBOX_MUTATION = graphql(/* GraphQL */ `
  mutation RecreateSandbox($input: RuntimeStateOperationInput!) {
    recreateSandbox(input: $input) {
      affectedSessionCount
      agentId
      ok
      operation
    }
  }
`);

export const RESET_AGENT_STATE_MUTATION = graphql(/* GraphQL */ `
  mutation ResetAgentState($input: RuntimeStateOperationInput!) {
    resetAgentState(input: $input) {
      affectedSessionCount
      agentId
      ok
      operation
    }
  }
`);
