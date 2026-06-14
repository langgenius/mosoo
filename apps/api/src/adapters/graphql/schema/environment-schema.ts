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

  enum EnvironmentRegistryRole {
    owner
    user
  }

  enum EnvironmentVariableStatus {
    configured
    pending
  }

  type EnvironmentOwnerSummary {
    id: ULID
    imageUrl: String
    name: String
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
    allowMcpServers: Boolean!
    allowPackageManagers: Boolean!
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
    isEditable: Boolean!
    name: String!
    networkPolicy: EnvironmentNetworkPolicy!
    owner: EnvironmentOwnerSummary!
    packages: [EnvironmentPackageSpec!]!
    role: EnvironmentRegistryRole!
    setupScript: String!
    updatedAt: String!
    usedByAgentCount: Int!
    appId: ULID!
  }

  type EnvironmentDetail {
    allowMcpServers: Boolean!
    allowPackageManagers: Boolean!
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
    isEditable: Boolean!
    name: String!
    networkPolicy: EnvironmentNetworkPolicy!
    owner: EnvironmentOwnerSummary!
    packages: [EnvironmentPackageSpec!]!
    role: EnvironmentRegistryRole!
    setupScript: String!
    updatedAt: String!
    usedByAgentCount: Int!
    appId: ULID!
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
    allowMcpServers: Boolean!
    allowPackageManagers: Boolean!
    allowedHosts: [String!]!
    description: String
    envVars: [EnvironmentVariableInput!]!
    name: String!
    networkPolicy: EnvironmentNetworkPolicy!
    appId: ULID!
    packages: [EnvironmentPackageSpecInput!]!
    setupScript: String!
  }

  input UpdateEnvironmentInput {
    allowMcpServers: Boolean!
    allowPackageManagers: Boolean!
    allowedHosts: [String!]!
    description: String
    environmentId: ULID!
    envVars: [EnvironmentVariableInput!]!
    name: String!
    networkPolicy: EnvironmentNetworkPolicy!
    packages: [EnvironmentPackageSpecInput!]!
    appId: ULID!
    setupScript: String!
  }

  input CreateEnvironmentForkInput {
    environmentId: ULID!
    appId: ULID!
  }

  input DeleteEnvironmentInput {
    environmentId: ULID!
    appId: ULID!
  }

  input SetAppDefaultEnvironmentInput {
    environmentId: ULID!
    appId: ULID!
  }

  input SetEnvironmentVariableValueInput {
    environmentId: ULID!
    key: String!
    appId: ULID!
    value: String!
  }
`;
