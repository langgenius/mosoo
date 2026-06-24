import { graphql } from "@/gql";

export const GET_AGENT_EDITOR_STATE_QUERY = graphql(/* GraphQL */ `
  query AgentEditorState($agentId: ULID!, $appId: ULID!) {
    agentEditorState(agentId: $agentId, appId: $appId) {
      id
      builtInTools {
        enabled
        name
      }
      environment {
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
            copiedAssetCount
            createdMcpServerCount
            reusedMcpServerCount
          }
        }
      }
      providerOptions
      mcpBindings {
        authType
        authorizationState
        createdAt
        credentialMode
        credentialScope
        credentialStatus
        credentialSubject
        enabled
        hasCredential
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
