export const skillSchema = /* GraphQL */ `
  enum SkillSourceKind {
    official
    user
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

  type SkillSummary {
    author: String!
    createdAt: String!
    description: String!
    fileCount: Int!
    forkOrigin: SkillForkOrigin
    id: ULID!
    name: String!
    ownerId: ULID!
    ownerName: String!
    appId: ULID!
    snapshotId: ULID!
    sourceKind: SkillSourceKind!
    updatedAt: String!
  }

  type SkillDetail {
    author: String!
    createdAt: String!
    currentSnapshot: SkillSnapshotRecord!
    description: String!
    entries: [SkillSnapshotEntry!]!
    fileCount: Int!
    forkOrigin: SkillForkOrigin
    id: ULID!
    name: String!
    ownerId: ULID!
    ownerName: String!
    appId: ULID!
    snapshotId: ULID!
    sourceKind: SkillSourceKind!
    updatedAt: String!
  }

  input CreateSkillForkInput {
    appId: ULID!
    skillId: ULID!
  }
`;
