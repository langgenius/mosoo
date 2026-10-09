export const environmentSchema = /* GraphQL */ `
  enum EnvironmentNetworkPolicy {
    full
    limited
  }

  enum EnvironmentPackageManager {
    apt
    cargo
    gem
    go
    npm
    pip
  }

  enum EnvironmentVariableStatus {
    configured
    pending
  }

  type EnvironmentForkOrigin {
    environmentId: ULID!
    name: String!
    ownerName: String!
  }

  type EnvironmentPackageSpec {
    manager: EnvironmentPackageManager!
    packages: [String!]!
  }

  type EnvironmentVariablePreview {
    key: String!
    preview: String!
    status: EnvironmentVariableStatus!
  }

  type EnvironmentSummary {
    allowedHosts: [String!]!
    canDelete: Boolean!
    canEdit: Boolean!
    createdAt: String!
    currentRevisionId: ULID!
    description: String!
    envVars: [EnvironmentVariablePreview!]!
    forkOrigin: EnvironmentForkOrigin
    id: ULID!
    isBuiltIn: Boolean!
    isDefault: Boolean!
    name: String!
    networkPolicy: EnvironmentNetworkPolicy!
    packages: [EnvironmentPackageSpec!]!
    setupScript: String!
    updatedAt: String!
    usedByAgentCount: Int!
    projectId: ULID!
  }

  type EnvironmentDetail {
    allowedHosts: [String!]!
    canDelete: Boolean!
    canEdit: Boolean!
    createdAt: String!
    currentRevisionId: ULID!
    description: String!
    envVars: [EnvironmentVariablePreview!]!
    forkOrigin: EnvironmentForkOrigin
    id: ULID!
    isBuiltIn: Boolean!
    isDefault: Boolean!
    name: String!
    networkPolicy: EnvironmentNetworkPolicy!
    packages: [EnvironmentPackageSpec!]!
    setupScript: String!
    updatedAt: String!
    usedByAgentCount: Int!
    projectId: ULID!
  }

  input EnvironmentPackageSpecInput {
    manager: EnvironmentPackageManager!
    packages: [String!]!
  }

  input EnvironmentVariableInput {
    key: String!
    value: String
  }

  input CreateEnvironmentInput {
    allowedHosts: [String!]!
    description: String
    envVars: [EnvironmentVariableInput!]!
    name: String!
    networkPolicy: EnvironmentNetworkPolicy!
    projectId: ULID!
    packages: [EnvironmentPackageSpecInput!]!
    setupScript: String!
  }

  input UpdateEnvironmentInput {
    allowedHosts: [String!]!
    description: String
    environmentId: ULID!
    envVars: [EnvironmentVariableInput!]!
    name: String!
    networkPolicy: EnvironmentNetworkPolicy!
    packages: [EnvironmentPackageSpecInput!]!
    projectId: ULID!
    setupScript: String!
  }

  input DeleteEnvironmentInput {
    environmentId: ULID!
    projectId: ULID!
  }

  input SetProjectDefaultEnvironmentInput {
    environmentId: ULID!
    projectId: ULID!
  }
`;
