import { graphql } from "@/gql";

export const GET_AGENT_EDITOR_STATE_QUERY = graphql(/* GraphQL */ `
  query AgentEditorState($agentId: ULID!) {
    agentEditorState(agentId: $agentId) {
      id
      environment {
        agentsFileId
        boundSpaceIds
        environmentId
      }
      packageResolution {
        recordedAt
        source
        report {
          issues {
            actionLabel
            code
            message
            required
            severity
            status
            targetLabel
            targetType
          }
          summary {
            boundMcpServerCount
            boundSkillCount
            boundSpaceCount
            copiedAssetCount
            createdMcpServerCount
            reusedMcpServerCount
          }
        }
      }
      collaborators {
        principal
        role
        name
        email
        imageUrl
      }
      mcpBindings {
        authType
        authorizationState
        createdAt
        credentialMode
        credentialScope
        credentialStatus
        credentialSubject
        enabled
        hasSharedCredential
        iconUrl
        id
        name
        serverId
        source
        updatedAt
        url
      }
      readiness {
        checkedAt
        ready
        issues {
          code
          message
          severity
        }
      }
    }
  }
`);

export const UPDATE_AGENT_CONFIG_MUTATION = graphql(/* GraphQL */ `
  mutation UpdateAgentConfig($input: UpdateAgentConfigInput!) {
    updateAgentConfig(input: $input) {
      ...AgentFields
    }
  }
`);
