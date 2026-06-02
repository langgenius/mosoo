export const skillSchema = /* GraphQL */ `
  enum SkillSourceKind {
    official
    user
  }

  enum SkillRegistryRole {
    owner
    user
  }

  enum SkillShareTargetKind {
    user
    organization
  }

  enum SkillSnapshotEntryKind {
    directory
    file
  }

  type SkillForkOrigin {
    name: String!
    ownerName: String!
    skillId: ULID!
  }

  type SkillSnapshotEntry {
    entryKind: SkillSnapshotEntryKind!
    isExecutable: Boolean!
    mimeType: String
    path: String!
    sha256: String
    size: Int!
  }

  type SkillSnapshotRecord {
    archiveFormat: String!
    author: String!
    blobKey: String!
    blobSha256: String!
    blobSize: Int!
    compression: String!
    createdAt: String!
    description: String!
    id: ULID!
    name: String!
    skillMarkdownPath: String!
    uncompressedSize: Int!
    version: String
  }

  type SkillShareTarget {
    createdAt: String!
    email: String
    id: ULID!
    kind: SkillShareTargetKind!
    name: String
  }

  type SkillSummary {
    author: String!
    autoEnabled: Boolean!
    createdAt: String!
    description: String!
    forkOrigin: SkillForkOrigin
    id: ULID!
    name: String!
    ownerId: ULID!
    ownerName: String!
    role: SkillRegistryRole!
    snapshotId: ULID!
    sourceKind: SkillSourceKind!
    updatedAt: String!
    organizationId: ULID!
  }

  type SkillDetail {
    author: String!
    autoEnabled: Boolean!
    createdAt: String!
    currentSnapshot: SkillSnapshotRecord!
    description: String!
    entries: [SkillSnapshotEntry!]!
    forkOrigin: SkillForkOrigin
    id: ULID!
    name: String!
    ownerId: ULID!
    ownerName: String!
    role: SkillRegistryRole!
    shareTargets: [SkillShareTarget!]!
    snapshotId: ULID!
    sourceKind: SkillSourceKind!
    updatedAt: String!
    organizationId: ULID!
  }

  type SkillAutoPreference {
    autoEnabled: Boolean!
    skillId: ULID!
  }

  input SetSkillAutoEnabledInput {
    autoEnabled: Boolean!
    skillId: ULID!
  }

  input CreateSkillForkInput {
    skillId: ULID!
  }

  input ShareSkillWithUserInput {
    email: String!
    skillId: ULID!
  }

  input ShareSkillWithOrganizationInput {
    skillId: ULID!
  }

  input UnshareSkillTargetInput {
    skillId: ULID!
    targetId: ULID!
    targetKind: SkillShareTargetKind!
  }
`;
