export const spaceSchema = /* GraphQL */ `
  type SpaceView {
    canDelete: Boolean!
    canUpdateAcl: Boolean!
    createdAt: String!
    creatorMembershipStatus: CreatorMembershipStatus!
    id: ULID!
    isSharedWithViewer: Boolean!
    name: String!
    ownerId: ULID!
    role: SpaceRole!
    storagePrefix: String!
    viewerAssetRole: SpaceRole!
    visibility: SpaceVisibility!
  }

  type Space {
    canDelete: Boolean!
    canUpdateAcl: Boolean!
    createdAt: String!
    creatorMembershipStatus: CreatorMembershipStatus!
    id: ULID!
    isSharedWithViewer: Boolean!
    name: String!
    ownerId: ULID!
    viewerAssetRole: SpaceRole!
    visibility: SpaceVisibility!
    organizationId: ULID!
  }

  type Collaborator {
    assignedBy: ULID
    createdAt: String!
    email: String
    imageUrl: String
    name: String
    principal: String!
    role: SpaceRole!
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

  enum CreatorMembershipStatus {
    active
    disabled
    removed
  }

  enum SpaceVisibility {
    private
    shared
  }

  enum SpaceRole {
    admin
    edit
    read
  }

  input CreateSpaceInput {
    name: String!
    visibility: SpaceVisibility
    organizationId: ULID!
  }

  input UpdateSpaceInput {
    name: String
    spaceId: ULID!
    visibility: SpaceVisibility
  }

  input AddCollaboratorInput {
    email: String!
    role: SpaceRole!
    spaceId: ULID!
  }

  input AddOrganizationCollaboratorInput {
    spaceId: ULID!
  }

  input UpdateCollaboratorInput {
    role: SpaceRole!
    spaceId: ULID!
    userId: ULID!
  }

  input RemoveCollaboratorInput {
    principal: String!
    spaceId: ULID!
  }

  input CreateSpaceDirectoryInput {
    name: String!
    path: String
    spaceId: ULID!
  }

  input DeleteSpaceEntryInput {
    key: String!
    spaceId: ULID!
  }
`;
