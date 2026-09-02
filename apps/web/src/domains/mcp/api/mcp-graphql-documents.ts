import { graphql } from "@/gql";

const MCP_CREDENTIAL_FIELDS = graphql(/* GraphQL */ `
  fragment McpCredentialFields on McpCredentialSummary {
    authType
    createdAt
    expiresAt
    id
    scope
    scopeValues
    status
    subjectLabel
    updatedAt
  }
`);

const MCP_SERVER_FIELDS = graphql(/* GraphQL */ `
  fragment McpServerFields on McpServerWithCredential {
    authType
    authorizationState
    createdAt
    credentialScope
    credentialStatus
    description
    enabled
    hasCredential
    iconUrl
    id
    name
    ownerId
    ownerName
    projectId
    source
    updatedAt
    url
    credential {
      ...McpCredentialFields
    }
  }
`);

const retainGraphQLFragments = (documents: readonly unknown[]): number => documents.length;

retainGraphQLFragments([MCP_CREDENTIAL_FIELDS, MCP_SERVER_FIELDS]);

export const MCP_REGISTRY_QUERY = graphql(/* GraphQL */ `
  query McpRegistry($projectId: ULID!) {
    mcpRegistry(projectId: $projectId) {
      currentUserEmail
      currentUserId
      currentUserName
      projectId
      servers {
        ...McpServerFields
      }
    }
  }
`);

export const CREATE_PROJECT_MCP_SERVER_MUTATION = graphql(/* GraphQL */ `
  mutation CreateProjectMcpServer($input: CreateProjectMcpServerInput!) {
    createProjectMcpServer(input: $input) {
      ...McpServerFields
    }
  }
`);

export const CONNECT_MCP_BEARER_MUTATION = graphql(/* GraphQL */ `
  mutation ConnectMcpBearer($input: ConnectMcpBearerInput!) {
    connectMcpBearer(input: $input) {
      ...McpServerFields
    }
  }
`);

export const REVOKE_MCP_CREDENTIAL_MUTATION = graphql(/* GraphQL */ `
  mutation RevokeMcpCredential($projectId: ULID!, $serverId: ULID!) {
    revokeMcpCredential(projectId: $projectId, serverId: $serverId) {
      ...McpServerFields
    }
  }
`);

export const SET_MCP_SERVER_ENABLED_MUTATION = graphql(/* GraphQL */ `
  mutation SetMcpServerEnabled($projectId: ULID!, $serverId: ULID!, $enabled: Boolean!) {
    setMcpServerEnabled(projectId: $projectId, serverId: $serverId, enabled: $enabled) {
      ...McpServerFields
    }
  }
`);

export const UPDATE_PROJECT_MCP_SERVER_MUTATION = graphql(/* GraphQL */ `
  mutation UpdateProjectMcpServer($input: UpdateProjectMcpServerInput!) {
    updateProjectMcpServer(input: $input) {
      ...McpServerFields
    }
  }
`);

export const DELETE_MCP_SERVER_MUTATION = graphql(/* GraphQL */ `
  mutation DeleteMcpServer($projectId: ULID!, $serverId: ULID!) {
    deleteMcpServer(projectId: $projectId, serverId: $serverId) {
      ok
    }
  }
`);

export const START_MCP_OAUTH_MUTATION = graphql(/* GraphQL */ `
  mutation StartMcpOAuth($input: StartMcpOAuthInput!) {
    startMcpOAuth(input: $input) {
      authorizationUrl
      flowId
    }
  }
`);

export const MCP_OAUTH_FLOW_STATUS_QUERY = graphql(/* GraphQL */ `
  query McpOAuthFlowStatus($flowId: ULID!) {
    mcpOAuthFlowStatus(flowId: $flowId) {
      authorizationState
      errorMessage
      flowId
      serverId
      status
      subjectLabel
    }
  }
`);
