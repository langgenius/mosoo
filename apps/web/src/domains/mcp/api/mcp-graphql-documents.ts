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
    hasSharedCredential
    iconUrl
    id
    name
    ownerId
    ownerName
    source
    updatedAt
    url
    organizationId
    credential {
      ...McpCredentialFields
    }
  }
`);

const retainGraphQLFragments = (documents: readonly unknown[]): number => documents.length;

retainGraphQLFragments([MCP_CREDENTIAL_FIELDS, MCP_SERVER_FIELDS]);

export const MCP_REGISTRY_QUERY = graphql(/* GraphQL */ `
  query McpRegistry($organizationId: ULID!) {
    mcpRegistry(organizationId: $organizationId) {
      currentUserEmail
      currentUserId
      currentUserName
      isAdmin
      personal {
        ...McpServerFields
      }
      organizationId
      organizationShared {
        ...McpServerFields
      }
    }
  }
`);

export const CREATE_PERSONAL_MCP_SERVER_MUTATION = graphql(/* GraphQL */ `
  mutation CreatePersonalMcpServer($input: CreatePersonalMcpServerInput!) {
    createPersonalMcpServer(input: $input) {
      ...McpServerFields
    }
  }
`);

export const CREATE_ORGANIZATION_MCP_SERVER_MUTATION = graphql(/* GraphQL */ `
  mutation CreateOrganizationMcpServer($input: CreateOrganizationMcpServerInput!) {
    createOrganizationMcpServer(input: $input) {
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

export const SET_ORGANIZATION_SHARED_BEARER_MUTATION = graphql(/* GraphQL */ `
  mutation SetOrganizationSharedBearer($input: SetOrganizationSharedMcpBearerInput!) {
    setOrganizationSharedBearer(input: $input) {
      ...McpServerFields
    }
  }
`);

export const CLEAR_ORGANIZATION_SHARED_CREDENTIAL_MUTATION = graphql(/* GraphQL */ `
  mutation ClearOrganizationSharedCredential($serverId: ULID!) {
    clearOrganizationSharedCredential(serverId: $serverId) {
      ...McpServerFields
    }
  }
`);

export const REVOKE_MCP_USER_CREDENTIAL_MUTATION = graphql(/* GraphQL */ `
  mutation RevokeMcpUserCredential($serverId: ULID!) {
    revokeMcpUserCredential(serverId: $serverId) {
      ...McpServerFields
    }
  }
`);

export const SET_MCP_SERVER_ENABLED_MUTATION = graphql(/* GraphQL */ `
  mutation SetMcpServerEnabled($serverId: ULID!, $enabled: Boolean!) {
    setMcpServerEnabled(serverId: $serverId, enabled: $enabled) {
      ...McpServerFields
    }
  }
`);

export const DELETE_MCP_SERVER_MUTATION = graphql(/* GraphQL */ `
  mutation DeleteMcpServer($serverId: ULID!) {
    deleteMcpServer(serverId: $serverId) {
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
