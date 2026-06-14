export const spaceSchema = /* GraphQL */ `
  type SpaceView {
    canDelete: Boolean!
    createdAt: String!
    id: ULID!
    name: String!
    ownerId: ULID!
    appId: ULID!
    role: SpaceRole!
    storagePrefix: String!
    viewerAssetRole: SpaceRole!
  }

  type Space {
    canDelete: Boolean!
    createdAt: String!
    id: ULID!
    name: String!
    ownerId: ULID!
    appId: ULID!
    viewerAssetRole: SpaceRole!
  }

  type DirectoryEntry {
    key: String!
  }

  type FileEntry {
    etag: String
    id: ULID!
    key: String!
    lock: SpaceFileLock
    mimeType: String
    size: Int!
    uploadedAt: String!
    version: Int!
  }

  type SpaceFileLock {
    expiresAt: Float!
    holder: SpaceFileLockHolder!
    path: String!
  }

  type SpaceFileLockHolder {
    displayName: String
    id: ULID!
    type: SpaceFileLockHolderType!
  }

  enum SpaceFileLockHolderType {
    agent
    user
  }

  type SpaceFileListing {
    directories: [DirectoryEntry!]!
    files: [FileEntry!]!
  }

  enum SpaceRole {
    admin
    edit
    read
  }

  input CreateSpaceInput {
    name: String!
    appId: ULID!
  }

  input UpdateSpaceInput {
    name: String
    appId: ULID!
    spaceId: ULID!
  }

  input CreateSpaceDirectoryInput {
    name: String!
    path: String
    appId: ULID!
    spaceId: ULID!
  }

  input DeleteSpaceEntryInput {
    key: String!
    appId: ULID!
    spaceId: ULID!
  }
`;
