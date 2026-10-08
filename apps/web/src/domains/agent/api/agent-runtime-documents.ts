import { graphql } from "@/gql";

export const PUBLISH_AGENT_MUTATION = graphql(/* GraphQL */ `
  mutation PublishAgent($input: PublishAgentInput!) {
    publishAgent(input: $input) {
      ...AgentFields
    }
  }
`);

export const UNPUBLISH_AGENT_MUTATION = graphql(/* GraphQL */ `
  mutation UnpublishAgent($agentId: ULID!, $projectId: ULID!) {
    unpublishAgent(agentId: $agentId, projectId: $projectId) {
      ...AgentFields
    }
  }
`);
