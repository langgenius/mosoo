import type {
  AccountId,
  AgentId,
  FileId,
  OrganizationId,
  SessionId,
  SpaceId,
} from "../id/id.contract";

export type SpaceVisibility = "private" | "shared";
export type SpaceRole = "admin" | "edit" | "read";

export const SPACE_NAME_MAX_LENGTH = 64;
export const SPACE_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export const SPACE_NAME_RULE_DESCRIPTION =
  "Space name must be 1-64 characters of lowercase letters, numbers, or hyphens, and cannot start or end with a hyphen.";

export function getSpaceNameValidationError(spaceName: string): string | null {
  if (!spaceName) {
    return null;
  }

  if (spaceName.length > SPACE_NAME_MAX_LENGTH) {
    return `Space name must be ${SPACE_NAME_MAX_LENGTH} characters or fewer.`;
  }

  if (!SPACE_NAME_PATTERN.test(spaceName)) {
    return SPACE_NAME_RULE_DESCRIPTION;
  }

  return null;
}

export interface SpaceView {
  canDelete: boolean;
  canUpdateAcl: boolean;
  createdAt: string;
  creatorMembershipStatus: "active" | "disabled" | "removed";
  id: SpaceId;
  isSharedWithViewer: boolean;
  name: string;
  ownerId: AccountId;
  role: SpaceRole;
  storagePrefix: string;
  viewerAssetRole: SpaceRole;
  visibility: SpaceVisibility;
}

export interface SpaceDetail {
  canDelete: boolean;
  canUpdateAcl: boolean;
  createdAt: string;
  creatorMembershipStatus: "active" | "disabled" | "removed";
  id: SpaceId;
  isSharedWithViewer: boolean;
  name: string;
  ownerId: AccountId;
  viewerAssetRole: SpaceRole;
  visibility: SpaceVisibility;
  organizationId: OrganizationId;
}

export interface Collaborator {
  assignedBy: AccountId | null;
  createdAt: string;
  email: string | null;
  imageUrl: string | null;
  name: string | null;
  principal: string;
  role: SpaceRole;
}

export interface SpaceWriteActor {
  id: AccountId | AgentId;
  type: "agent" | "user";
}

export interface SpaceWriteStaleEvent {
  actor?: SpaceWriteActor | undefined;
  current_etag?: string | undefined;
  path: string;
  reason: "deleted" | "modified";
  session_id?: SessionId | undefined;
  turn_id?: string | undefined;
  type: "space.write.stale";
}

export interface SpaceFileLockHolder {
  displayName: string | null;
  id: AccountId | AgentId;
  type: "agent" | "user";
}

export interface SpaceFileLockView {
  expiresAt: number;
  holder: SpaceFileLockHolder;
  path: string;
}

export interface AcquireSpaceFileLockRequest {
  path: string;
  ttlSeconds?: number | undefined;
}

export interface AcquireSpaceFileLockResponse {
  expiresAt?: number | undefined;
  holder?: SpaceFileLockHolder | undefined;
  lockId?: string | undefined;
  ok: boolean;
}

export interface ReleaseSpaceFileLockRequest {
  lockId?: string | undefined;
  path: string;
}

export interface ReleaseSpaceFileLockResponse {
  ok: boolean;
}

export interface SpaceLockEvent {
  lock: SpaceFileLockView;
  type: "space.lock.acquired" | "space.lock.released";
}

export interface FileEntry {
  etag: string | null;
  id: FileId;
  mimeType: string | null;
  key: string;
  lock: SpaceFileLockView | null;
  size: number;
  uploadedAt: string;
  version: number;
}

export interface DirectoryEntry {
  key: string;
}

export interface SpaceFileListing {
  directories: DirectoryEntry[];
  files: FileEntry[];
}

export interface CreateSpaceInput {
  name: string;
  visibility?: SpaceVisibility;
  organizationId: OrganizationId;
}

export interface UpdateSpaceInput {
  name?: string;
  spaceId: SpaceId;
  visibility?: SpaceVisibility;
}

export interface AddCollaboratorInput {
  email: string;
  role: SpaceRole;
  spaceId: SpaceId;
}

export interface AddOrganizationCollaboratorInput {
  spaceId: SpaceId;
}

export interface UpdateCollaboratorInput {
  role: SpaceRole;
  spaceId: SpaceId;
  userId: AccountId;
}

export interface RemoveCollaboratorInput {
  principal: string;
  spaceId: SpaceId;
}

export interface CreateSpaceDirectoryInput {
  name: string;
  path?: string;
  spaceId: SpaceId;
}

export interface DeleteSpaceEntryInput {
  key: string;
  spaceId: SpaceId;
}
