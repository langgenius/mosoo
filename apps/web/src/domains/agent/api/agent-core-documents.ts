import { graphql } from "@/gql";

const AGENT_FIELDS = graphql(/* GraphQL */ `
  fragment AgentFields on Agent {
    createdAt
    description
    id
    kind
    liveVersion {
      ...AgentDeploymentVersionFields
    }
    model
    name
    appId
    prompt
    provider
    runtimeId
    skills {
      ownerName
      skillId
      skillName
      state
    }
    status
    updatedAt
    visibility
  }
`);

const AGENT_TOOL_SUMMARY_FIELDS = graphql(/* GraphQL */ `
  fragment AgentToolSummaryFields on AgentToolSummary {
    enabled
    iconUrl
    name
    serverId
  }
`);

const AGENT_DEPLOYMENT_VERSION_FIELDS = graphql(/* GraphQL */ `
  fragment AgentDeploymentVersionFields on AgentDeploymentVersion {
    agentId
    createdAt
    createdByAccountId
    environmentId
    id
    isLive
    kind
    model
    provider
    runtimeId
    sourceCommitSha
    summary
    versionNumber
  }
`);

const AGENT_OWNER_FIELDS = graphql(/* GraphQL */ `
  fragment AgentOwnerFields on AgentOwnerSummary {
    id
    imageUrl
    name
  }
`);

const retainGraphQLFragments = (documents: readonly unknown[]): number => documents.length;

retainGraphQLFragments([
  AGENT_DEPLOYMENT_VERSION_FIELDS,
  AGENT_FIELDS,
  AGENT_OWNER_FIELDS,
  AGENT_TOOL_SUMMARY_FIELDS,
]);

export const CREATE_AGENT_MUTATION = graphql(/* GraphQL */ `
  mutation CreateAgent($input: CreateAgentInput!) {
    createAgent(input: $input) {
      ...AgentFields
    }
  }
`);

export const DELETE_AGENT_MUTATION = graphql(/* GraphQL */ `
  mutation DeleteAgent($input: DeleteAgentInput!) {
    deleteAgent(input: $input) {
      ok
    }
  }
`);

export const LIST_VISIBLE_AGENTS_QUERY = graphql(/* GraphQL */ `
  query AccessibleAgents($appId: ULID!) {
    accessibleAgentList(appId: $appId) {
      createdAt
      description
      id
      kind
      name
      appId
      owner {
        ...AgentOwnerFields
      }
      runtimeId
      status
      tools {
        ...AgentToolSummaryFields
      }
      updatedAt
      viewerRole
      visibility
    }
  }
`);

export const GET_AGENT_QUERY = graphql(/* GraphQL */ `
  query Agent($agentId: ULID!, $appId: ULID!) {
    agent(agentId: $agentId, appId: $appId) {
      createdAt
      description
      exposedViaApi
      id
      kind
      liveVersion {
        ...AgentDeploymentVersionFields
      }
      model
      name
      appId
      owner {
        ...AgentOwnerFields
      }
      prompt
      provider
      runtimeId
      skills {
        ownerName
        skillId
        skillName
        state
      }
      status
      tools {
        ...AgentToolSummaryFields
      }
      updatedAt
      versions {
        ...AgentDeploymentVersionFields
      }
      viewerRole
      visibility
    }
  }
`);
