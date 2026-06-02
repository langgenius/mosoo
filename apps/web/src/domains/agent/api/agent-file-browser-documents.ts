import { graphql } from "@/gql";

const agentFileSessionNodeFields = graphql(/* GraphQL */ `
  fragment AgentFileSessionNodeFields on AgentFileSessionNode {
    active
    id
    status
    title
    updatedAt
  }
`);

const agentFileSpaceMountFields = graphql(/* GraphQL */ `
  fragment AgentFileSpaceMountFields on AgentFileSpaceMountNode {
    path
    spaceId
    spaceName
    url
  }
`);

const agentFileEntryFields = graphql(/* GraphQL */ `
  fragment AgentFileEntryFields on AgentFileEntry {
    kind
    mimeType
    name
    path
    persistence
    preview
    session {
      ...AgentFileSessionNodeFields
    }
    sizeBytes
    space {
      ...AgentFileSpaceMountFields
    }
  }
`);

const retainGraphQLFragments = (documents: readonly unknown[]): number => documents.length;

retainGraphQLFragments([
  agentFileEntryFields,
  agentFileSessionNodeFields,
  agentFileSpaceMountFields,
]);

export const AGENT_FILE_TREE_QUERY = graphql(/* GraphQL */ `
  query AgentFileTree($agentId: ULID!, $path: String!) {
    agentFileTree(agentId: $agentId, path: $path) {
      agentId
      entries {
        ...AgentFileEntryFields
      }
      lastError
      path
      sandboxId
      sandboxStatus
      totalCount
      truncated
    }
  }
`);

export const AGENT_FILE_CONTENT_QUERY = graphql(/* GraphQL */ `
  query AgentFileContent($agentId: ULID!, $path: String!) {
    agentFileContent(agentId: $agentId, path: $path) {
      agentId
      content
      mimeType
      name
      path
      preview
      sandboxId
      sizeBytes
    }
  }
`);
