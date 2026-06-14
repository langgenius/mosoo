import { graphql } from "@/gql";

export const GET_AGENT_MANIFEST_QUERY = graphql(/* GraphQL */ `
  query AgentManifest($agentId: ULID!, $appId: ULID!) {
    agentManifest(agentId: $agentId, appId: $appId) {
      agentId
      json
      yaml
    }
  }
`);

export const EXPORT_AGENT_PACKAGE_QUERY = graphql(/* GraphQL */ `
  query ExportAgentPackage($agentId: ULID!, $appId: ULID!) {
    exportAgentPackage(agentId: $agentId, appId: $appId) {
      agentId
      contentType
      fileId
      fileName
      manifestYaml
      size
    }
  }
`);

export const UPDATE_AGENT_PACKAGE_SHARING_MUTATION = graphql(/* GraphQL */ `
  mutation UpdateAgentPackageSharing($input: UpdateAgentPackageSharingInput!) {
    updateAgentPackageSharing(input: $input) {
      ...AgentFields
    }
  }
`);

export const IMPORT_AGENT_PACKAGE_MUTATION = graphql(/* GraphQL */ `
  mutation ImportAgentPackage($input: ImportAgentPackageInput!) {
    importAgentPackage(input: $input) {
      agent {
        ...AgentFields
      }
      resolution {
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
  }
`);

export const CREATE_AGENT_FORK_MUTATION = graphql(/* GraphQL */ `
  mutation CreateAgentFork($input: CreateAgentForkInput!) {
    createAgentFork(input: $input) {
      agent {
        ...AgentFields
      }
      resolution {
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
  }
`);
